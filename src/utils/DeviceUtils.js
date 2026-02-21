// utils/DeviceUtils.js

const ua = navigator.userAgent;

/**
 * Regex matching standalone VR headset browsers (Quest, Pico, Vive, Apple Vision Pro).
 */
const STANDALONE_XR_REGEX = /OculusBrowser|PicoBrowser|ViveBrowser|AppleVision/i;

/**
 * Regex matching mobile phones and tablets.
 */
const MOBILE_REGEX = /Android|iPhone|iPad|iPod|Mobile/i;

/**
 * True if the current device is a mobile phone/tablet (but NOT a standalone XR headset).
 */
export const isMobile = MOBILE_REGEX.test(ua) && !STANDALONE_XR_REGEX.test(ua);

/**
 * True if the current device is a true VR/XR headset or a desktop PC (PCVR-capable).
 * Returns false for mobile phones to avoid showing VR entry for Cardboard-only devices.
 */
export const isTrueHMD = STANDALONE_XR_REGEX.test(ua) || !MOBILE_REGEX.test(ua);
