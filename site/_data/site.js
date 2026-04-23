const pkg = require('../../package.json');

module.exports = {
  baseUrl: 'https://pointsharvest.com',
  extensionVersion: `v${pkg.version}`,
  downloadUrl: `https://r2.pointsharvest.com/PointsHarvest-v${pkg.version}.zip`,
  githubUrl: 'https://github.com/landkirk/PointsHarvest',
};
