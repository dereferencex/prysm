const baseConfig = require("./app.json");

module.exports = () => {
  const isFdroid = process.env.PRYSM_FDROID === "1";

  const config = baseConfig.expo;

  const android = { ...(config.android || {}) };

  if (isFdroid) {
    android.permissions = (android.permissions || []).filter(
      (permission) => permission !== "REQUEST_INSTALL_PACKAGES",
    );
  }

  return {
    ...config,
    android,
    extra: {
      ...(config.extra || {}),
      isFdroid,
    },
  };
};
