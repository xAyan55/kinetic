const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { compareMinecraftVersions } = require('./mcjars-client');

/**
 * Host Java Runtime Environment Manager
 */
class JavaRuntimeManager {
  constructor() {
    this.detectedRuntimes = null;
  }

  /**
   * Scans the host system for all installed Java runtime binaries
   */
  detectHostRuntimes() {
    if (this.detectedRuntimes) return this.detectedRuntimes;

    const runtimes = [];
    const candidatePaths = new Set();

    // 1. Default system java in PATH
    try {
      const defaultPath = execSync(os.platform() === 'win32' ? 'where java' : 'which java', { timeout: 2000 })
        .toString().split(/\r?\n/)[0].trim();
      if (defaultPath) candidatePaths.add(defaultPath);
    } catch (e) {}

    // 2. Standard Linux JVM directories
    if (os.platform() === 'linux') {
      const jvmDir = '/usr/lib/jvm';
      if (fs.existsSync(jvmDir)) {
        try {
          const entries = fs.readdirSync(jvmDir);
          for (const entry of entries) {
            const fullBin = path.join(jvmDir, entry, 'bin', 'java');
            if (fs.existsSync(fullBin)) {
              candidatePaths.add(fullBin);
            }
          }
        } catch (e) {}
      }

      // Check update-alternatives
      try {
        const altOut = execSync('update-alternatives --list java 2>/dev/null', { timeout: 2000 }).toString();
        for (const line of altOut.split(/\r?\n/)) {
          if (line.trim() && fs.existsSync(line.trim())) {
            candidatePaths.add(line.trim());
          }
        }
      } catch (e) {}
    }

    // 3. Inspect each candidate path
    for (const binPath of candidatePaths) {
      try {
        const versionOutput = execSync(`"${binPath}" -version 2>&1`, { timeout: 3000 }).toString();
        const major = this.parseJavaMajorVersion(versionOutput);
        if (major) {
          runtimes.push({
            path: binPath,
            majorVersion: major,
            fullVersion: versionOutput.split(/\r?\n/)[0].trim(),
            rawOutput: versionOutput
          });
        }
      } catch (err) {
        // Inaccessible or broken binary
      }
    }

    // Sort by major version descending
    runtimes.sort((a, b) => b.majorVersion - a.majorVersion);

    // Fallback if no runtimes found
    if (runtimes.length === 0) {
      runtimes.push({
        path: 'java',
        majorVersion: 21,
        fullVersion: 'System default java',
        rawOutput: ''
      });
    }

    this.detectedRuntimes = runtimes;
    return runtimes;
  }

  /**
   * Extracts major integer version from `java -version` output
   */
  parseJavaMajorVersion(versionString) {
    if (!versionString) return 21;
    // Patterns: "21.0.2", "17.0.10", "1.8.0_392", "openjdk 21"
    const match1 = versionString.match(/version "1\.(\d+)/); // Java 1.8 -> 8
    if (match1) return parseInt(match1[1], 10);

    const match2 = versionString.match(/version "(\d+)/); // Java 17, 21
    if (match2) return parseInt(match2[1], 10);

    const match3 = versionString.match(/openjdk (\d+)/i);
    if (match3) return parseInt(match3[1], 10);

    return 21;
  }

  /**
   * Resolves the required Java version for a specific software/version/build
   */
  getRequiredJavaVersion({ softwareType, version, javaRequirement }) {
    if (typeof javaRequirement === 'number' && javaRequirement > 0) {
      return javaRequirement;
    }

    const upperType = (softwareType || '').toUpperCase();
    const ver = String(version || '1.20.4');

    // Proxies run modern Java
    if (['VELOCITY', 'WATERFALL', 'BUNGEECORD', 'VELOCITY_CTD'].includes(upperType)) {
      return 17;
    }

    // Limbo runtimes
    if (['LOOHP_LIMBO', 'LOOHPLIMBO', 'NANOLIMBO'].includes(upperType)) {
      return 17;
    }

    // Minecraft version rules
    if (compareMinecraftVersions(ver, '1.20.5') <= 0 || ver.startsWith('26.')) {
      return 21; // MC 1.20.5+ and 26.x requires Java 21
    }
    if (compareMinecraftVersions(ver, '1.18') <= 0) {
      return 17; // MC 1.18 to 1.20.4 requires Java 17
    }
    if (compareMinecraftVersions(ver, '1.17') <= 0) {
      return 16; // MC 1.17 requires Java 16/17
    }
    return 8; // MC <= 1.16.5 requires Java 8
  }

  /**
   * Resolves the best matching runtime on the host
   */
  resolveRuntime({ softwareType, version, javaRequirement, build }) {
    const requiredVersion = this.getRequiredJavaVersion({ softwareType, version, javaRequirement });
    const hostRuntimes = this.detectHostRuntimes();

    // 1. Try exact major version match
    const exactMatch = hostRuntimes.find(r => r.majorVersion === requiredVersion);
    if (exactMatch) {
      return {
        javaPath: exactMatch.path,
        javaMajorVersion: exactMatch.majorVersion,
        requiredVersion,
        isExactMatch: true,
        explanation: `${softwareType || 'Minecraft'} ${version || ''} requires Java ${requiredVersion}. Matching runtime found.`
      };
    }

    // 2. Try nearest compatible higher runtime (e.g. Java 21 can run Java 17/8 in most modern servers)
    const higherMatch = hostRuntimes.find(r => r.majorVersion >= requiredVersion);
    if (higherMatch) {
      return {
        javaPath: higherMatch.path,
        javaMajorVersion: higherMatch.majorVersion,
        requiredVersion,
        isExactMatch: false,
        explanation: `${softwareType || 'Minecraft'} ${version || ''} requires Java ${requiredVersion}. Running on Java ${higherMatch.majorVersion}.`
      };
    }

    // 3. Fallback to highest installed runtime
    const fallback = hostRuntimes[0];
    return {
      javaPath: fallback ? fallback.path : 'java',
      javaMajorVersion: fallback ? fallback.majorVersion : 21,
      requiredVersion,
      isExactMatch: false,
      explanation: `${softwareType || 'Minecraft'} ${version || ''} recommends Java ${requiredVersion}. Using host default Java (${fallback ? fallback.majorVersion : 'Default'}).`
    };
  }
}

const javaManager = new JavaRuntimeManager();

module.exports = {
  JavaRuntimeManager,
  javaManager,
  resolveJavaRuntime: (opts) => javaManager.resolveRuntime(opts)
};
