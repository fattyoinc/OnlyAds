// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Production builds must not contain the fictional demo catalog (src/data/sampleOffers.ts).
// Swap it for an empty stub at resolution time; verified by e2e/check-bundle.js.
if (process.env.EXPO_PUBLIC_APP_ENV === 'production') {
  const stub = path.resolve(__dirname, 'src/data/sampleOffers.stub.ts');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (/(^|\/)sampleOffers$/.test(moduleName)) return { type: 'sourceFile', filePath: stub };
    return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
