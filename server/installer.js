const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');
const { mcjars } = require('./mcjars-client');
const { resolveJavaRuntime } = require('./java-runtime');

/**
 * Allowed artifact download host patterns for security validation
 */
const ALLOWED_ARTIFACT_HOSTS = [
  'mcjars.app',
  's3.mcjars.app',
  'files.mcjars.app',
  'versions.mcjars.app',
  'papermc.io',
  'fill-data.papermc.io',
  'api.purpurmc.org',
  'purpurmc.org',
  'piston-data.mojang.com',
  'piston-meta.mojang.com',
  'maven.fabricmc.net',
  'maven.quiltmc.org',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  'spongepowered.org',
  'mohistmc.com'
];

/**
 * Validates if an artifact URL belongs to an approved trusted repository
 */
function isAllowedArtifactUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_ARTIFACT_HOSTS.some(host => 
      parsed.hostname === host || parsed.hostname.endsWith('.' + host)
    );
  } catch (e) {
    return false;
  }
}

/**
 * Downloads a remote file with streaming hash calculation and timeout
 */
function downloadFileWithHash(urlStr, destPath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isAllowedArtifactUrl(urlStr)) {
      return reject(new Error(`Download URL rejected by security policy: ${urlStr}`));
    }

    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const file = fs.createWriteStream(destPath);

    const sha256Hash = crypto.createHash('sha256');
    const sha1Hash = crypto.createHash('sha1');
    const md5Hash = crypto.createHash('md5');
    let totalBytes = 0;

    const req = transport.get(urlStr, {
      headers: { 'User-Agent': 'KineticHost-Installer/2.0' },
      timeout: options.timeoutMs || 45000
    }, (response) => {
      // Follow HTTP redirects safely
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        const redirectUrl = new URL(response.headers.location, urlStr).toString();
        return downloadFileWithHash(redirectUrl, destPath, options).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${response.statusCode} while downloading artifact from ${urlStr}`));
      }

      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        sha256Hash.update(chunk);
        sha1Hash.update(chunk);
        md5Hash.update(chunk);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          resolve({
            bytes: totalBytes,
            sha256: sha256Hash.digest('hex'),
            sha1: sha1Hash.digest('hex'),
            md5: md5Hash.digest('hex')
          });
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error(`Download timed out: ${urlStr}`));
    });

    req.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Extracts expected checksum from download URL or metadata
 */
function extractExpectedChecksum(urlStr) {
  // Paper / Velocity fill-data URL: .../objects/<64-char sha256>/...
  const sha256Match = urlStr.match(/\/objects\/([a-fA-F0-9]{64})\//);
  if (sha256Match) {
    return { hash: sha256Match[1].toLowerCase(), algorithm: 'sha256' };
  }

  // Mojang piston-data URL: .../objects/<40-char sha1>/...
  const sha1Match = urlStr.match(/\/objects\/([a-fA-F0-9]{40})\//);
  if (sha1Match) {
    return { hash: sha1Match[1].toLowerCase(), algorithm: 'sha1' };
  }

  return null;
}

/**
 * Safely extracts a ZIP archive with strict Zip-Slip protection
 */
function extractZipSafely(zipFilePath, targetDir) {
  const zipBuffer = fs.readFileSync(zipFilePath);
  let offset = 0;

  while (offset < zipBuffer.length - 30) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // End of local file headers

    const flags = zipBuffer.readUInt16LE(offset + 6);
    const method = zipBuffer.readUInt16LE(offset + 8);
    const compSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompSize = zipBuffer.readUInt32LE(offset + 22);
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);

    const nameBuffer = zipBuffer.subarray(offset + 30, offset + 30 + nameLen);
    const fileName = nameBuffer.toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressedData = zipBuffer.subarray(dataStart, dataStart + compSize);

    // Strict Zip-Slip Prevention
    const normalizedName = path.normalize(fileName).replace(/^(\.\.[\/\\])+/, '');
    if (normalizedName.startsWith('..') || path.isAbsolute(fileName)) {
      throw new Error(`Zip-Slip security violation blocked: ${fileName}`);
    }

    const fullDest = path.join(targetDir, normalizedName);
    const resolvedTarget = path.resolve(targetDir);
    const resolvedDest = path.resolve(fullDest);

    if (!resolvedDest.startsWith(resolvedTarget)) {
      throw new Error(`Path traversal attempt blocked: ${fileName}`);
    }

    if (fileName.endsWith('/') || fileName.endsWith('\\')) {
      fs.mkdirSync(fullDest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullDest), { recursive: true });
      if (method === 8) {
        const decompressed = zlib.inflateRawSync(compressedData);
        fs.writeFileSync(fullDest, decompressed);
      } else if (method === 0) {
        fs.writeFileSync(fullDest, compressedData);
      }
    }

    offset = dataStart + compSize;
  }
}

/**
 * Standard Minecraft Server Configuration Writer
 */
function configureServer(serverDir, config = {}) {
  const { port = 25565, name = 'KineticHost Server', motd, eulaAcceptedAt = new Date().toISOString() } = config;

  // 1. Write eula.txt
  const eulaContent = [
    '#By changing the setting below to TRUE you are indicating your agreement to the Minecraft EULA (https://aka.ms/MinecraftEULA).',
    `#EULA accepted by user on ${eulaAcceptedAt}`,
    'eula=true\n'
  ].join('\n');
  fs.writeFileSync(path.join(serverDir, 'eula.txt'), eulaContent, 'utf8');

  // 2. Write server.properties
  const serverProps = [
    '#KineticHost Server Properties',
    `#Generated on ${new Date().toISOString()}`,
    `server-port=${port}`,
    'server-ip=0.0.0.0',
    `motd=${motd || '§bKineticHost §8• §f' + name}`,
    'max-players=20',
    'online-mode=true',
    'enable-query=true',
    `query.port=${port}`,
    'enable-rcon=false',
    'view-distance=10',
    'simulation-distance=8',
    'difficulty=easy',
    'gamemode=survival',
    'pvp=true',
    'spawn-protection=0\n'
  ].join('\n');
  fs.writeFileSync(path.join(serverDir, 'server.properties'), serverProps, 'utf8');
}

/**
 * Atomic MCJars Server Installer
 */
async function installMCJarsServer({
  serverId,
  baseDir,
  finalServerDir,
  softwareType,
  version,
  buildUuid,
  port = 25565,
  name = 'Kinetic Server',
  eulaAcceptedAt = new Date().toISOString()
}) {
  const upperType = (softwareType || 'PAPER').toUpperCase();
  const targetVersion = version || '1.20.4';

  // 1. Create atomic temporary installation directory
  const stagingBaseDir = path.join(baseDir, '.installing');
  if (!fs.existsSync(stagingBaseDir)) {
    fs.mkdirSync(stagingBaseDir, { recursive: true });
  }

  const stagingDir = path.join(stagingBaseDir, String(serverId));
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    // 2. Resolve build details from MCJars API
    let buildDetails;
    if (buildUuid) {
      buildDetails = await mcjars.getBuildDetails(buildUuid);
    } else {
      const latest = await mcjars.getLatestBuild(upperType, targetVersion);
      buildDetails = await mcjars.getBuildDetails(latest.uuid);
    }

    if (!buildDetails) {
      throw new Error(`Failed to resolve build from MCJars for ${upperType} ${targetVersion}`);
    }

    console.log(`[Installer] Provisioning ${upperType} ${targetVersion} (Build ${buildDetails.name}) into staging directory...`);

    // 3. Resolve required Java runtime
    const javaResolution = resolveJavaRuntime({
      softwareType: upperType,
      version: targetVersion,
      javaRequirement: buildDetails.javaRequirement
    });

    console.log(`[Installer] Resolved Java Runtime: ${javaResolution.javaPath} (${javaResolution.explanation})`);

    // 4. Process installation steps defined by MCJars
    const installationSteps = buildDetails.installation || [];
    let installedJarName = 'server.jar';
    let downloadedChecksum = null;
    let mainArtifactUrl = buildDetails.jarUrl || buildDetails.zipUrl;

    if (installationSteps.length > 0) {
      for (const stepGroup of installationSteps) {
        if (!Array.isArray(stepGroup)) continue;

        for (const step of stepGroup) {
          if (step.type === 'download' && step.url) {
            const fileName = step.file || (step.url.endsWith('.zip') ? 'server.zip' : 'server.jar');
            const destPath = path.join(stagingDir, fileName);
            mainArtifactUrl = step.url;

            console.log(`[Installer] Downloading artifact: ${step.url} -> ${fileName}`);
            const hashResult = await downloadFileWithHash(step.url, destPath);
            downloadedChecksum = hashResult.sha256;

            // Checksum verification
            const expected = extractExpectedChecksum(step.url);
            if (expected) {
              const actualHash = expected.algorithm === 'sha256' ? hashResult.sha256 : (expected.algorithm === 'sha1' ? hashResult.sha1 : hashResult.md5);
              if (actualHash !== expected.hash) {
                throw new Error(`Checksum mismatch for ${fileName}! Expected ${expected.hash} (${expected.algorithm}), calculated ${actualHash}`);
              }
              console.log(`[Installer] Checksum verified successfully (${expected.algorithm}: ${actualHash})`);
            }

            if (fileName.endsWith('.jar')) {
              installedJarName = fileName;
            }
          } else if (step.type === 'unzip' && step.file) {
            const zipPath = path.join(stagingDir, step.file);
            const targetExtractDir = step.location === '.' ? stagingDir : path.join(stagingDir, step.location || '.');

            if (fs.existsSync(zipPath)) {
              console.log(`[Installer] Extracting archive safely: ${step.file} with Zip-Slip protection...`);
              extractZipSafely(zipPath, targetExtractDir);
            }
          } else if (step.type === 'remove') {
            const targetToRemove = path.join(stagingDir, step.location || step.file || '');
            if (fs.existsSync(targetToRemove)) {
              fs.rmSync(targetToRemove, { recursive: true, force: true });
            }
          }
        }
      }
    } else {
      // Fallback if no explicit installation array was returned
      if (buildDetails.jarUrl) {
        const destPath = path.join(stagingDir, 'server.jar');
        const hashResult = await downloadFileWithHash(buildDetails.jarUrl, destPath);
        downloadedChecksum = hashResult.sha256;
      } else {
        throw new Error(`MCJars did not provide a download URL for ${upperType} ${targetVersion}`);
      }
    }

    // 5. Verify executable server JAR exists in staging directory
    let finalJarPath = path.join(stagingDir, installedJarName);
    if (!fs.existsSync(finalJarPath)) {
      // Search for any .jar file in root
      const files = fs.readdirSync(stagingDir);
      const jarFile = files.find(f => f.endsWith('.jar'));
      if (jarFile) {
        installedJarName = jarFile;
        finalJarPath = path.join(stagingDir, jarFile);
      } else {
        throw new Error('No server JAR file found in provisioned directory.');
      }
    }

    // 6. Write server.properties and eula.txt
    configureServer(stagingDir, {
      port,
      name,
      eulaAcceptedAt
    });

    // 7. Atomically promote staging directory to final server destination
    if (fs.existsSync(finalServerDir)) {
      fs.rmSync(finalServerDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(finalServerDir), { recursive: true });

    try {
      fs.renameSync(stagingDir, finalServerDir);
    } catch (renameErr) {
      // Fallback copy if crossing mount points
      fs.cpSync(stagingDir, finalServerDir, { recursive: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    console.log(`[Installer] Atomic deployment completed: ${finalServerDir}`);

    return {
      success: true,
      softwareType: upperType,
      softwareName: buildDetails.type || upperType,
      version: targetVersion,
      build: buildDetails.name || '#1',
      buildUuid: buildDetails.uuid,
      artifactUrl: mainArtifactUrl,
      artifactType: mainArtifactUrl && mainArtifactUrl.endsWith('.zip') ? 'zip' : 'jar',
      artifactSha256: downloadedChecksum,
      javaVersion: javaResolution.requiredVersion,
      javaPath: javaResolution.javaPath,
      serverJar: installedJarName,
      port
    };
  } catch (err) {
    // Clean rollback
    console.error(`[Installer] Installation failed, rolling back staging directory:`, err.message);
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {}
    throw err;
  }
}

/**
 * Legacy Paper and Vanilla Installer classes for backward compatibility
 */
class PaperInstaller {
  getSoftwareName() { return 'paper'; }
  async getSupportedVersions() {
    const versions = await mcjars.getVersions('PAPER');
    return versions.map(v => v.id);
  }
  async install(serverDir, version, options = {}) {
    return installMCJarsServer({
      serverId: options.serverId || Date.now(),
      baseDir: path.dirname(serverDir),
      finalServerDir: serverDir,
      softwareType: 'PAPER',
      version,
      port: options.port,
      name: options.name,
      eulaAcceptedAt: options.eulaAcceptedAt
    });
  }
}

class VanillaInstaller {
  getSoftwareName() { return 'vanilla'; }
  async getSupportedVersions() {
    const versions = await mcjars.getVersions('VANILLA');
    return versions.map(v => v.id);
  }
  async install(serverDir, version, options = {}) {
    return installMCJarsServer({
      serverId: options.serverId || Date.now(),
      baseDir: path.dirname(serverDir),
      finalServerDir: serverDir,
      softwareType: 'VANILLA',
      version,
      port: options.port,
      name: options.name,
      eulaAcceptedAt: options.eulaAcceptedAt
    });
  }
}

const installers = {
  paper: new PaperInstaller(),
  vanilla: new VanillaInstaller()
};

function getInstaller(software) {
  const lower = (software || '').toLowerCase();
  if (installers[lower]) return installers[lower];
  return {
    getSoftwareName: () => software,
    getSupportedVersions: async () => {
      const v = await mcjars.getVersions(software);
      return v.map(x => x.id);
    },
    install: async (serverDir, version, options = {}) => {
      return installMCJarsServer({
        serverId: options.serverId || Date.now(),
        baseDir: path.dirname(serverDir),
        finalServerDir: serverDir,
        softwareType: software,
        version,
        port: options.port,
        name: options.name,
        eulaAcceptedAt: options.eulaAcceptedAt
      });
    }
  };
}

module.exports = {
  installMCJarsServer,
  downloadFileWithHash,
  extractZipSafely,
  extractExpectedChecksum,
  configureServer,
  getInstaller,
  PaperInstaller,
  VanillaInstaller,
  installers
};
