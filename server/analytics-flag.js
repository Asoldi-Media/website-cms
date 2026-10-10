/** In-process switch the public tracker reads. Set from the hub config on each request. */
let enabled = process.env.CMS_DEV_ANALYTICS === '1';
/** Turn the public tracker on or off for this process. */
export function setPublicAnalyticsEnabled(value) {
    enabled = value === true;
}
/** Whether public pages should load the tracker. */
export function isPublicAnalyticsEnabled() {
    return enabled === true;
}
