const fs = require('fs');
const path = require('path');

const MAX_EDIT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB max for text editor
const EDITABLE_EXTENSIONS = new Set([
  '.properties', '.json', '.yml', '.yaml', '.txt', '.log',
  '.cfg', '.conf', '.toml', '.sh', '.xml', '.env', '.md',
  '.csv', '.ini', '.cmd', '.bat'
]);

/**
 * Validates and canonicalizes a path against the server's base directory.
 * Throws an error if any path traversal or escaping is attempted.
 */
function validateSafePath(serverDir, relativePath = '') {
  if (!serverDir || typeof serverDir !== 'string') {
    throw new Error('Server directory path is required.');
  }

  const normalizedServerDir = path.resolve(serverDir);
  const targetPath = path.resolve(normalizedServerDir, relativePath.replace(/^(\/|\\)+/, ''));

  // Ensure target starts strictly with the server root path
  if (!targetPath.startsWith(normalizedServerDir)) {
    const err = new Error('Access forbidden: Path traverses outside server directory.');
    err.code = 'PATH_FORBIDDEN';
    err.statusCode = 403;
    throw err;
  }

  // If the target already exists, resolve realpath to avoid symlink directory escape
  if (fs.existsSync(targetPath)) {
    try {
      const realTarget = fs.realpathSync(targetPath);
      const realServerDir = fs.existsSync(normalizedServerDir) ? fs.realpathSync(normalizedServerDir) : normalizedServerDir;
      if (!realTarget.startsWith(realServerDir)) {
        const err = new Error('Access forbidden: Symlink escape detected.');
        err.code = 'SYMLINK_ESCAPE';
        err.statusCode = 403;
        throw err;
      }
    } catch (e) {
      if (e.code === 'PATH_FORBIDDEN' || e.code === 'SYMLINK_ESCAPE') throw e;
    }
  }

  return targetPath;
}

/**
 * Lists contents of a server directory
 */
function listFiles(serverDir, subPath = '') {
  const targetDir = validateSafePath(serverDir, subPath);

  if (!fs.existsSync(targetDir)) {
    const err = new Error('Directory not found.');
    err.code = 'DIRECTORY_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    const err = new Error('Target path is not a directory.');
    err.code = 'NOT_A_DIRECTORY';
    err.statusCode = 400;
    throw err;
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const relativeBase = path.relative(path.resolve(serverDir), targetDir).replace(/\\/g, '/');

  const files = [];
  const directories = [];

  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry.name);
    let entryStat;
    try {
      entryStat = fs.statSync(entryPath);
    } catch (e) {
      continue; // Skip inaccessible or broken socket/pipe entries
    }

    const ext = path.extname(entry.name).toLowerCase();
    const isDir = entry.isDirectory();
    const relItemPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

    const item = {
      name: entry.name,
      path: relItemPath,
      isDirectory: isDir,
      sizeBytes: isDir ? 0 : entryStat.size,
      modifiedAt: entryStat.mtime.toISOString(),
      extension: ext,
      isEditable: !isDir && (EDITABLE_EXTENSIONS.has(ext) || entryStat.size === 0)
    };

    if (isDir) {
      directories.push(item);
    } else {
      files.push(item);
    }
  }

  // Sort directories first, then alphabetical
  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    currentPath: relativeBase || '',
    breadcrumbs: getBreadcrumbs(relativeBase),
    entries: [...directories, ...files]
  };
}

/**
 * Builds breadcrumbs array for UI navigation
 */
function getBreadcrumbs(relativeBase) {
  if (!relativeBase) return [{ name: 'root', path: '' }];

  const parts = relativeBase.split('/').filter(Boolean);
  const crumbs = [{ name: 'root', path: '' }];

  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    crumbs.push({ name: part, path: accumulated });
  }

  return crumbs;
}

/**
 * Reads a text file's contents safely
 */
function getFileContent(serverDir, relativeFilePath) {
  const targetFile = validateSafePath(serverDir, relativeFilePath);

  if (!fs.existsSync(targetFile)) {
    const err = new Error(`File "${relativeFilePath}" not found.`);
    err.code = 'FILE_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(targetFile);
  if (stat.isDirectory()) {
    const err = new Error('Cannot edit a directory as text.');
    err.code = 'IS_A_DIRECTORY';
    err.statusCode = 400;
    throw err;
  }

  if (stat.size > MAX_EDIT_SIZE_BYTES) {
    const err = new Error(`File is too large to edit in browser (${(stat.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 2 MB.`);
    err.code = 'FILE_TOO_LARGE';
    err.statusCode = 413;
    throw err;
  }

  const buffer = fs.readFileSync(targetFile);

  // Check for binary zero bytes in first 800 bytes
  const isBinary = buffer.slice(0, 800).some(byte => byte === 0);
  if (isBinary) {
    const err = new Error('Binary file detected. Binary files cannot be edited in the text editor.');
    err.code = 'BINARY_FILE';
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(relativeFilePath).toLowerCase();
  return {
    path: relativeFilePath.replace(/\\/g, '/'),
    name: path.basename(relativeFilePath),
    content: buffer.toString('utf8'),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    extension: ext
  };
}

/**
 * Saves content to a text file atomically
 */
function saveFileContent(serverDir, relativeFilePath, content = '') {
  const targetFile = validateSafePath(serverDir, relativeFilePath);
  const parentDir = path.dirname(targetFile);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const tempFile = `${targetFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, content, 'utf8');
  fs.renameSync(tempFile, targetFile);

  const stat = fs.statSync(targetFile);
  return {
    path: relativeFilePath.replace(/\\/g, '/'),
    name: path.basename(relativeFilePath),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

/**
 * Creates an empty file
 */
function createFile(serverDir, relativeFilePath) {
  const targetFile = validateSafePath(serverDir, relativeFilePath);

  if (fs.existsSync(targetFile)) {
    const err = new Error('A file or directory with that name already exists.');
    err.code = 'FILE_EXISTS';
    err.statusCode = 409;
    throw err;
  }

  const parentDir = path.dirname(targetFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(targetFile, '', 'utf8');
  return { path: relativeFilePath.replace(/\\/g, '/'), name: path.basename(relativeFilePath) };
}

/**
 * Creates a directory
 */
function createDirectory(serverDir, relativeSubPath) {
  const targetDir = validateSafePath(serverDir, relativeSubPath);

  if (fs.existsSync(targetDir)) {
    const err = new Error('A file or directory with that name already exists.');
    err.code = 'DIRECTORY_EXISTS';
    err.statusCode = 409;
    throw err;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  return { path: relativeSubPath.replace(/\\/g, '/'), name: path.basename(relativeSubPath) };
}

/**
 * Renames a file or directory
 */
function renamePath(serverDir, oldRelPath, newRelPath) {
  const oldPath = validateSafePath(serverDir, oldRelPath);
  const newPath = validateSafePath(serverDir, newRelPath);

  if (!fs.existsSync(oldPath)) {
    const err = new Error('Source file or directory not found.');
    err.code = 'SOURCE_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  if (fs.existsSync(newPath)) {
    const err = new Error('Destination file or directory already exists.');
    err.code = 'DESTINATION_EXISTS';
    err.statusCode = 409;
    throw err;
  }

  fs.renameSync(oldPath, newPath);
  return {
    oldPath: oldRelPath.replace(/\\/g, '/'),
    newPath: newRelPath.replace(/\\/g, '/'),
    name: path.basename(newRelPath)
  };
}

/**
 * Deletes a file or directory
 */
function deletePath(serverDir, targetRelPath) {
  const targetPath = validateSafePath(serverDir, targetRelPath);
  const normalizedServerDir = path.resolve(serverDir);

  // Guard: NEVER delete the server root itself
  if (targetPath === normalizedServerDir) {
    const err = new Error('Cannot delete server root directory.');
    err.code = 'ROOT_DELETION_FORBIDDEN';
    err.statusCode = 403;
    throw err;
  }

  if (!fs.existsSync(targetPath)) {
    const err = new Error('File or directory not found.');
    err.code = 'NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return { path: targetRelPath.replace(/\\/g, '/') };
}

/**
 * Prepares a download stream for a file
 */
function getDownloadStream(serverDir, relativeFilePath) {
  const targetFile = validateSafePath(serverDir, relativeFilePath);

  if (!fs.existsSync(targetFile)) {
    const err = new Error('File not found.');
    err.code = 'FILE_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(targetFile);
  if (stat.isDirectory()) {
    const err = new Error('Cannot download a directory directly. Please create a backup archive instead.');
    err.code = 'IS_A_DIRECTORY';
    err.statusCode = 400;
    throw err;
  }

  return {
    stream: fs.createReadStream(targetFile),
    name: path.basename(targetFile),
    sizeBytes: stat.size
  };
}

/**
 * Handles streaming upload of a file safely
 */
function handleFileUpload(serverDir, relativeTargetDir, req) {
  return new Promise((resolve, reject) => {
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB
    let totalBytes = 0;

    const contentType = req.headers['content-type'] || '';
    const rawFilename = req.headers['x-filename'] || req.query.filename || 'uploaded_file';
    const cleanFilename = path.basename(decodeURIComponent(rawFilename)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetFilePath = relativeTargetDir ? `${relativeTargetDir}/${cleanFilename}` : cleanFilename;

    const targetFile = validateSafePath(serverDir, targetFilePath);
    const parentDir = path.dirname(targetFile);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const tempFile = `${targetFile}.upload.tmp.${Date.now()}`;
    const writeStream = fs.createWriteStream(tempFile);

    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;

      let fileDataStream = req;
      let chunks = [];

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxSizeBytes) {
          writeStream.destroy();
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          const err = new Error('File upload exceeds maximum allowed size (100 MB).');
          err.code = 'FILE_TOO_LARGE';
          err.statusCode = 413;
          return reject(err);
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        if (!boundary) {
          fs.writeFileSync(targetFile, fullBuffer);
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          const stat = fs.statSync(targetFile);
          return resolve({ path: targetFilePath.replace(/\\/g, '/'), name: cleanFilename, sizeBytes: stat.size });
        }

        // Extract multipart body between boundary markers
        const boundaryBuf = Buffer.from(`--${boundary}`);
        const headerEnd = Buffer.from('\r\n\r\n');
        const startIdx = fullBuffer.indexOf(boundaryBuf);
        if (startIdx !== -1) {
          const bodyStart = fullBuffer.indexOf(headerEnd, startIdx) + 4;
          const endIdx = fullBuffer.indexOf(Buffer.from(`\r\n--${boundary}`), bodyStart);
          const fileContent = endIdx !== -1 ? fullBuffer.slice(bodyStart, endIdx) : fullBuffer.slice(bodyStart);

          fs.writeFileSync(tempFile, fileContent);
          fs.renameSync(tempFile, targetFile);
          const stat = fs.statSync(targetFile);
          return resolve({ path: targetFilePath.replace(/\\/g, '/'), name: cleanFilename, sizeBytes: stat.size });
        }

        fs.writeFileSync(targetFile, fullBuffer);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        const stat = fs.statSync(targetFile);
        return resolve({ path: targetFilePath.replace(/\\/g, '/'), name: cleanFilename, sizeBytes: stat.size });
      });

      req.on('error', (err) => {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        reject(err);
      });
    } else {
      // Direct raw octet stream
      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxSizeBytes) {
          writeStream.destroy();
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          const err = new Error('File upload exceeds maximum allowed size (100 MB).');
          err.code = 'FILE_TOO_LARGE';
          err.statusCode = 413;
          return reject(err);
        }
        writeStream.write(chunk);
      });

      req.on('end', () => {
        writeStream.end(() => {
          fs.renameSync(tempFile, targetFile);
          const stat = fs.statSync(targetFile);
          resolve({
            path: targetFilePath.replace(/\\/g, '/'),
            name: cleanFilename,
            sizeBytes: stat.size
          });
        });
      });

      req.on('error', (err) => {
        writeStream.destroy();
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        reject(err);
      });
    }
  });
}

module.exports = {
  validateSafePath,
  listFiles,
  getFileContent,
  saveFileContent,
  createFile,
  createDirectory,
  renamePath,
  deletePath,
  getDownloadStream,
  handleFileUpload
};
