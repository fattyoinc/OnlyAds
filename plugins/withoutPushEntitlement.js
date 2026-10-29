/**
 * expo-notifications adds the iOS push entitlement (aps-environment) by default.
 * Only Ads schedules LOCAL notifications only, which need no entitlement, so we
 * remove it: no push capability on the App ID, no push token, nothing to disclose.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
};
