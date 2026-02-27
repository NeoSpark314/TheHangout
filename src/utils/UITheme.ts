/**
 * 80s Synthwave / Outrun Color Palette and Styling Constants
 * Used globally across Canvas UI components to ensure consistency with HTML/CSS.
 */
export const UITheme = {
    colors: {
        primary: '#00ffff',          // Neon Cyan (Active elements, borders, highlights)
        primaryHover: '#00cccc',     // Darker Cyan

        secondary: '#ff00ff',        // Neon Magenta (Warnings, toggles)
        secondaryHover: '#cc00cc',   // Darker Magenta

        accent: '#ffaa00',           // Neon Orange/Gold (Callouts)

        background: '#0a041c',       // Deep Space Violet (Root backgrounds)
        panelBg: 'rgba(10, 4, 28, 0.85)', // Translucent Violet (Panels/Tabs/Buttons)
        panelBgHover: 'rgba(20, 10, 50, 0.95)', // Lighter Violet for hovers

        text: '#f8fafc',             // Off-white / High contrast
        textMuted: '#64748b',        // Disabled / Inactive text

        border: '#ff00ff',           // Standard borders default to Magenta in this theme
        borderActive: '#00ffff',     // Active borders default to Cyan
    },
    typography: {
        fontFamily: 'Inter, Arial, sans-serif',
        sizes: {
            title: 64,
            header: 48,
            body: 32,
            small: 24
        }
    },
    styling: {
        borderWidth: 3,
        cornerRadius: 8
    }
};

/**
 * Returns a completed Canvas font string based on the theme specs.
 */
export function getFont(size: number, weight: 'normal' | 'bold' | 'italic' = 'normal'): string {
    return `${weight} ${size}px ${UITheme.typography.fontFamily}`;
}
