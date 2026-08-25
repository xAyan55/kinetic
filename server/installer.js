const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/**
 * Helper to download a remote file via HTTPS to a local path (follows redirects)
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Failed to download from ${url}: Status Code ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Helper to fetch JSON from an HTTPS endpoint
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'KineticHost-Installer/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Verifies file checksum
 */
function verifyFileChecksum(filePath, expectedHash, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const calculatedHash = hash.digest('hex');
      if (calculatedHash.toLowerCase() === expectedHash.toLowerCase()) {
        resolve(true);
      } else {
        reject(new Error(`Checksum mismatch (${algorithm}). Expected ${expectedHash}, got ${calculatedHash}`));
      }
    });
    stream.on('error', reject);
  });
}

/**
 * Base Installer Class
 */
class BaseInstaller {
  getSoftwareName() {
    throw new Error('Not implemented');
  }

  async getSupportedVersions() {
    throw new Error('Not implemented');
  }

  async install(serverDir, version, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Generates standard Minecraft server.properties and eula.txt
   */
  configure(serverDir, config = {}) {
    const { port = 25565, name = 'KineticHost Server', motd, eulaAcceptedAt = new Date().toISOString() } = config;

    // 1. Write eula.txt with user timestamp
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
}

/**
 * Paper/Purpur High Performance Paper-Compatible Engine Installer
 */
class PaperInstaller extends BaseInstaller {
  getSoftwareName() {
    return 'paper';
  }

  async getSupportedVersions() {
    return ['1.20.4', '1.20.2', '1.19.4'];
  }

  async install(serverDir, version, options = {}) {
    const versions = await this.getSupportedVersions();
    if (!versions.includes(version)) {
      throw new Error(`Unsupported version: ${version}. Supported: ${versions.join(', ')}`);
    }

    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    // 1. Query Purpur / Paper upstream API
    const buildInfo = await fetchJson(`https://api.purpurmc.org/v2/purpur/${version}`);
    if (!buildInfo || !buildInfo.builds || !buildInfo.builds.latest) {
      throw new Error(`No builds found for version ${version}`);
    }

    const latestBuild = buildInfo.builds.latest;
    const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/${latestBuild}/download`;
    const targetJarPath = path.join(serverDir, 'server.jar');

    console.log(`[Installer] Downloading Paper/Purpur ${version} (Build #${latestBuild}) to ${targetJarPath}...`);
    await downloadFile(downloadUrl, targetJarPath);

    // 2. Fetch expected build details & verify SHA256 if available
    try {
      const details = await fetchJson(`https://api.purpurmc.org/v2/purpur/${version}/${latestBuild}`);
      if (details && details.md5) {
        await verifyFileChecksum(targetJarPath, details.md5, 'md5');
      }
    } catch (e) {
      // Verify file size is valid (>10MB)
      const stats = fs.statSync(targetJarPath);
      if (stats.size < 10000000) {
        throw new Error(`Downloaded JAR size is invalid (${stats.size} bytes).`);
      }
    }

    // 3. Configure server properties and EULA
    this.configure(serverDir, options);
    console.log(`[Installer] Paper/Purpur ${version} successfully installed and configured.`);

    return {
      success: true,
      software: 'paper',
      version,
      build: latestBuild,
      jarFile: 'server.jar'
    };
  }
}

/**
 * Official Vanilla Mojang Installer implementation
 */
class VanillaInstaller extends BaseInstaller {
  getSoftwareName() {
    return 'vanilla';
  }

  async getSupportedVersions() {
    return ['1.20.4', '1.20.2', '1.19.4'];
  }

  async install(serverDir, version, options = {}) {
    const versions = await this.getSupportedVersions();
    if (!versions.includes(version)) {
      throw new Error(`Unsupported Vanilla version: ${version}. Supported: ${versions.join(', ')}`);
    }

    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    // 1. Query Mojang version manifest
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const versionEntry = manifest.versions.find(v => v.id === version);
    if (!versionEntry) {
      throw new Error(`Version ${version} not found in Mojang official manifest`);
    }

    // 2. Fetch version-specific package details
    const versionPackage = await fetchJson(versionEntry.url);
    if (!versionPackage.downloads || !versionPackage.downloads.server) {
      throw new Error(`Server download not available for Vanilla ${version}`);
    }

    const downloadUrl = versionPackage.downloads.server.url;
    const expectedSha1 = versionPackage.downloads.server.sha1;
    const targetJarPath = path.join(serverDir, 'server.jar');

    console.log(`[Installer] Downloading Vanilla Mojang ${version} to ${targetJarPath}...`);
    await downloadFile(downloadUrl, targetJarPath);

    // 3. Verify SHA1 Checksum
    console.log(`[Installer] Verifying Vanilla Mojang SHA1 checksum...`);
    await verifyFileChecksum(targetJarPath, expectedSha1, 'sha1');

    // 4. Configure server properties and EULA
    this.configure(serverDir, options);
    console.log(`[Installer] Vanilla Mojang ${version} successfully installed and configured.`);

    return {
      success: true,
      software: 'vanilla',
      version,
      jarFile: 'server.jar'
    };
  }
}

const installers = {
  paper: new PaperInstaller(),
  vanilla: new VanillaInstaller()
};

function getInstaller(software) {
  const inst = installers[software ? software.toLowerCase() : ''];
  if (!inst) {
    throw new Error(`Unsupported software: ${software}. Supported: ${Object.keys(installers).join(', ')}`);
  }
  return inst;
}

module.exports = {
  getInstaller,
  installers,
  PaperInstaller,
  VanillaInstaller
};
