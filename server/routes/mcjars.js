const express = require('express');
const router = express.Router();
const { mcjars } = require('../mcjars-client');
const { resolveJavaRuntime } = require('../java-runtime');

// Authentication middleware check
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

/**
 * GET /api/mcjars/types
 * Returns full dynamically discovered software catalog grouped with real icons and metadata
 */
router.get('/types', requireAuth, async (req, res) => {
  try {
    const types = await mcjars.getTypes();
    return res.json({
      success: true,
      types
    });
  } catch (err) {
    console.error('[MCJars Route Error - Types]:', err.message);
    return res.status(502).json({
      success: false,
      error: `Failed to retrieve software catalog from MCJars: ${err.message}`
    });
  }
});

/**
 * GET /api/mcjars/types/:type/versions
 * Returns all dynamically discovered versions for a specific software type
 */
router.get('/types/:type/versions', requireAuth, async (req, res) => {
  const { type } = req.params;
  try {
    const versions = await mcjars.getVersions(type);
    return res.json({
      success: true,
      type: type.toUpperCase(),
      versions
    });
  } catch (err) {
    console.error(`[MCJars Route Error - Versions for ${type}]:`, err.message);
    return res.status(502).json({
      success: false,
      error: `Failed to retrieve versions for ${type} from MCJars: ${err.message}`
    });
  }
});

/**
 * GET /api/mcjars/types/:type/versions/:version/builds
 * Returns builds for a specific software type and version
 */
router.get('/types/:type/versions/:version/builds', requireAuth, async (req, res) => {
  const { type, version } = req.params;
  try {
    const builds = await mcjars.getBuilds(type, version);
    return res.json({
      success: true,
      type: type.toUpperCase(),
      version,
      builds
    });
  } catch (err) {
    console.error(`[MCJars Route Error - Builds for ${type} ${version}]:`, err.message);
    return res.status(502).json({
      success: false,
      error: `Failed to retrieve builds for ${type} ${version} from MCJars: ${err.message}`
    });
  }
});

/**
 * GET /api/mcjars/types/:type/versions/:version/latest
 * Resolves the latest build details for software + version
 */
router.get('/types/:type/versions/:version/latest', requireAuth, async (req, res) => {
  const { type, version } = req.params;
  try {
    const latest = await mcjars.getLatestBuild(type, version);
    const javaRes = resolveJavaRuntime({
      softwareType: type,
      version,
      javaRequirement: latest.javaRequirement
    });

    return res.json({
      success: true,
      type: type.toUpperCase(),
      version,
      build: latest,
      java: javaRes
    });
  } catch (err) {
    console.error(`[MCJars Route Error - Latest Build for ${type} ${version}]:`, err.message);
    return res.status(502).json({
      success: false,
      error: `Failed to resolve latest build for ${type} ${version}: ${err.message}`
    });
  }
});

/**
 * GET /api/mcjars/builds/:uuid
 * Resolves full build details and artifact download URLs
 */
router.get('/builds/:uuid', requireAuth, async (req, res) => {
  const { uuid } = req.params;
  try {
    const details = await mcjars.getBuildDetails(uuid);
    const javaRes = resolveJavaRuntime({
      softwareType: details.type,
      version: details.versionId,
      javaRequirement: details.javaRequirement
    });

    return res.json({
      success: true,
      build: details,
      java: javaRes
    });
  } catch (err) {
    console.error(`[MCJars Route Error - Build Details for ${uuid}]:`, err.message);
    return res.status(502).json({
      success: false,
      error: `Failed to fetch build details for ${uuid}: ${err.message}`
    });
  }
});

/**
 * POST /api/mcjars/resolve-java
 * Resolves required Java runtime for software & version
 */
router.post('/resolve-java', requireAuth, (req, res) => {
  const { softwareType, version, javaRequirement } = req.body || {};
  const resolved = resolveJavaRuntime({ softwareType, version, javaRequirement });
  return res.json({
    success: true,
    ...resolved
  });
});

module.exports = router;
