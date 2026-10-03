let enabled = process.env.CMS_DEV_ANALYTICS === '1';

export function setPublicAnalyticsEnabled(value) {
  enabled = value === true;
}

export function isPublicAnalyticsEnabled() {
  return enabled === true;
}
