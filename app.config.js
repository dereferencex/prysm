module.exports = ({ config }) => {
  const isFdroid = process.env.PRYSM_FDROID === "1";

  const android = { ...(config.expo.android || {}) };
  if (isFdroid) {
    android.permissions = (android.permissions || []).filter(
      (permission) => permission !== "REQUEST_INSTALL_PACKAGES",
    );
  }

  return {
    ...config,
    expo: {
      ...config.expo,
      android,
      extra: {
        ...(config.expo.extra || {}),
        isFdroid,
      },
    },
  };
};
