export interface IAvatarUrlValidationResult {
    valid: boolean;
    error: string | null;
}

function isAbsoluteUrl(value: string): boolean {
    return /^[a-z][a-z0-9+\-.]*:\/\//i.test(value);
}

export function validateVrmUrl(value: string, baseHref: string, currentOrigin: string): IAvatarUrlValidationResult {
    const trimmed = value.trim();
    if (!trimmed) {
        return {
            valid: true,
            error: null
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed, baseHref);
    } catch {
        return {
            valid: false,
            error: 'Enter a valid relative path or https URL.'
        };
    }

    const lowerPath = parsed.pathname.toLowerCase();
    if (!lowerPath.endsWith('.vrm')) {
        return {
            valid: false,
            error: 'Avatar URL must point to a .vrm file.'
        };
    }

    if (isAbsoluteUrl(trimmed)) {
        if (parsed.protocol !== 'https:' && parsed.origin !== currentOrigin) {
            return {
                valid: false,
                error: 'Only https URLs or same-origin URLs are allowed.'
            };
        }
    } else if (parsed.origin !== currentOrigin) {
        return {
            valid: false,
            error: 'Relative avatar paths must stay on the same origin.'
        };
    }

    return {
        valid: true,
        error: null
    };
}
