/**
 * 80s Synthwave / Outrun Color Palette and Styling Constants
 * Used globally across Canvas UI components to ensure consistency with HTML/CSS.
 */
export const UITheme = {
    colors: {
        primary: '#00ffff',          // Neon Cyan
        primaryHover: '#00cccc',

        secondary: '#ff00ff',        // Neon Magenta
        secondaryHover: '#cc00cc',

        accent: '#ffaa00',           // Neon Orange/Gold
        danger: '#ef4444',           // Error / Destructive
        dangerHover: '#dc2626',

        background: '#0a041c',       // Deep Space Violet
        panelBg: 'rgba(10, 4, 28, 0.85)',
        panelBgHover: 'rgba(20, 10, 50, 0.95)',

        text: '#f8fafc',             // Off-white
        textMuted: '#64748b',

        border: '#ff00ff',           // Default Magenta
        borderActive: '#00ffff',     // Active Cyan
    },
    typography: {
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        sizes: {
            title: 54,               // Balanced for 1280x800
            header: 42,
            body: 28,
            small: 20
        }
    },
    styling: {
        borderWidth: 2,
        cornerRadius: 12
    }
};

/**
 * Returns a completed Canvas font string based on the theme specs.
 */
export function getFont(size: number, weight: 'normal' | 'bold' | 'italic' = 'normal'): string {
    return `${weight} ${size}px ${UITheme.typography.fontFamily}`;
}
