const ua = navigator.userAgent;
const STANDALONE_XR_REGEX = /OculusBrowser|PicoBrowser|ViveBrowser|AppleVision/i;
const MOBILE_REGEX = /Android|iPhone|iPad|iPod|Mobile/i;

export const isMobile = MOBILE_REGEX.test(ua) && !STANDALONE_XR_REGEX.test(ua);
export const isTrueHMD = STANDALONE_XR_REGEX.test(ua) || !MOBILE_REGEX.test(ua);
