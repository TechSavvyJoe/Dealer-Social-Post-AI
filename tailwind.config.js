/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./utils/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // LIGHT TABLE type (spec §4.2): Barlow for every UI string, Barlow
      // Semi Condensed for screen titles, dialog titles and large numerals.
      fontFamily: {
        sans: ["Barlow", "Helvetica Neue", "Arial", "sans-serif"],
        display: [
          "Barlow Semi Condensed",
          "Barlow",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },

      // LIGHT TABLE palette (spec §4.1). The product is achromatic; the
      // dealer's brand colour is the single accent. Every `primary` step
      // resolves through the --brand-N-rgb custom properties (achromatic by
      // default in styles/globals.css, overridden per dealer and per theme by
      // useDealerTheme), so bg-/text-/ring-primary-* utilities are
      // white-label-aware without touching call sites. 50–200 and 800–950
      // collapse onto the lightest/darkest ramp steps so no static blue
      // survives on an untouched screen.
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        "panel-raised": "rgb(var(--panel-raised) / <alpha-value>)",
        overlay: "rgb(var(--overlay) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          2: "rgb(var(--ink-2) / <alpha-value>)",
          3: "rgb(var(--ink-3) / <alpha-value>)",
          hint: "rgb(var(--ink-hint) / <alpha-value>)",
        },
        brand: {
          ink: "rgb(var(--brand-ink) / <alpha-value>)",
          foreground: "var(--brand-foreground)",
        },
        primary: {
          50: "rgb(var(--brand-300-rgb) / <alpha-value>)",
          100: "rgb(var(--brand-300-rgb) / <alpha-value>)",
          200: "rgb(var(--brand-300-rgb) / <alpha-value>)",
          300: "rgb(var(--brand-300-rgb) / <alpha-value>)",
          400: "rgb(var(--brand-400-rgb) / <alpha-value>)",
          500: "rgb(var(--brand-500-rgb) / <alpha-value>)",
          600: "rgb(var(--brand-600-rgb) / <alpha-value>)",
          700: "rgb(var(--brand-700-rgb) / <alpha-value>)",
          800: "rgb(var(--brand-700-rgb) / <alpha-value>)",
          900: "rgb(var(--brand-700-rgb) / <alpha-value>)",
          950: "rgb(var(--brand-700-rgb) / <alpha-value>)",
        },

        // Secondary is a calm slate, not purple — per the DEALER TRUST system.
        secondary: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569", // Main secondary
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },

        // Success (Apple green)
        success: {
          ink: "rgb(var(--success-ink) / <alpha-value>)",
          fill: "var(--success-fill)",
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a", // Main success
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
        },

        // Warning (Amber)
        warning: {
          ink: "rgb(var(--warning-ink) / <alpha-value>)",
          fill: "var(--warning-fill)",
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b", // Main warning
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
          950: "#451a03",
        },

        // Error (Red)
        error: {
          ink: "rgb(var(--error-ink) / <alpha-value>)",
          fill: "var(--error-fill)",
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444", // Main error
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
          950: "#450a0a",
        },

        // Info (Cyan)
        info: {
          ink: "rgb(var(--info-ink) / <alpha-value>)",
          fill: "var(--info-fill)",
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4", // Main info
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
          950: "#083344",
        },

        // Surface scale (now managed by CSS variables for Sunlight Mode)
        surface: {
          50: "rgb(var(--surface-50) / <alpha-value>)",
          100: "rgb(var(--surface-100) / <alpha-value>)",
          200: "rgb(var(--surface-200) / <alpha-value>)",
          300: "rgb(var(--surface-300) / <alpha-value>)",
          400: "rgb(var(--surface-400) / <alpha-value>)",
          500: "rgb(var(--surface-500) / <alpha-value>)",
          600: "rgb(var(--surface-600) / <alpha-value>)",
          700: "rgb(var(--surface-700) / <alpha-value>)",
          800: "rgb(var(--surface-800) / <alpha-value>)",
          900: "rgb(var(--surface-900) / <alpha-value>)",
          950: "rgb(var(--surface-950) / <alpha-value>)",
        },
      },

      // Theme-aware semantic aliases — the target vocabulary for retiring
      // dark-only bg-white/* , border-white/* , and text-white utilities.
      backgroundColor: {
        "fill-subtle": "var(--fill-subtle)",
        "fill-hover": "var(--fill-hover)",
        "brand-fill": "rgb(var(--brand-ink) / 0.12)",
        "surface-base": "rgb(var(--color-surface-base) / <alpha-value>)",
        "surface-elevated": "rgb(var(--color-surface-elevated) / <alpha-value>)",
        "surface-overlay": "rgb(var(--color-surface-overlay) / <alpha-value>)",
        "surface-raised": "rgb(var(--color-surface-raised) / <alpha-value>)",
      },
      borderColor: {
        hairline: "rgb(var(--color-border) / <alpha-value>)",
        strong: "rgb(var(--color-border-strong) / <alpha-value>)",
      },
      ringColor: {
        hairline: "rgb(var(--color-border) / <alpha-value>)",
        strong: "rgb(var(--color-border-strong) / <alpha-value>)",
      },
      textColor: {
        "content-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "content-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "content-tertiary": "rgb(var(--color-text-tertiary) / <alpha-value>)",
      },

      // Spacing scale - 4px base unit (consistent with Apple HIG)
      spacing: {
        0.5: "0.125rem", // 2px
        1: "0.25rem", // 4px
        1.5: "0.375rem", // 6px
        2: "0.5rem", // 8px
        2.5: "0.625rem", // 10px
        3: "0.75rem", // 12px
        3.5: "0.875rem", // 14px
        4: "1rem", // 16px
        5: "1.25rem", // 20px
        6: "1.5rem", // 24px
        7: "1.75rem", // 28px
        8: "2rem", // 32px
        9: "2.25rem", // 36px
        10: "2.5rem", // 40px
        11: "2.75rem", // 44px (Apple touch target)
        12: "3rem", // 48px
        14: "3.5rem", // 56px
        16: "4rem", // 64px
        20: "5rem", // 80px
        24: "6rem", // 96px
        28: "7rem", // 112px
        32: "8rem", // 128px
        36: "9rem", // 144px
        40: "10rem", // 160px
        44: "11rem", // 176px
        48: "12rem", // 192px
        52: "13rem", // 208px
        56: "14rem", // 224px
        60: "15rem", // 240px
        64: "16rem", // 256px
        72: "18rem", // 288px
        80: "20rem", // 320px
        96: "24rem", // 384px
      },

      // Font sizes with proper line heights
      fontSize: {
        // Spec §4.2 scale. Barlow needs no tracking below display size.
        "2xs": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0" }], // 12px micro
        xs: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0" }], // 12px
        sm: ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "0" }], // 14px label
        caption: ["0.8125rem", { lineHeight: "1.125rem", letterSpacing: "0" }], // 13px
        base: ["1rem", { lineHeight: "1.5rem", letterSpacing: "0" }], // 16px body
        lg: ["1.125rem", { lineHeight: "1.5rem", letterSpacing: "0" }], // 18px title-2
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "0" }], // 20px
        "2xl": ["1.5rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }], // 24px title-1
        "3xl": ["1.75rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }], // 28px display (phone)
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.01em" }], // 36px display
        "5xl": ["3rem", { lineHeight: "1", letterSpacing: "-0.015em" }], // 48px
        "6xl": ["3.75rem", { lineHeight: "1", letterSpacing: "-0.015em" }], // 60px
        "7xl": ["4.5rem", { lineHeight: "1", letterSpacing: "-0.015em" }], // 72px
        "8xl": ["6rem", { lineHeight: "1", letterSpacing: "-0.015em" }], // 96px
        "9xl": ["8rem", { lineHeight: "1", letterSpacing: "-0.015em" }], // 128px
      },

      // Box shadows - Apple-inspired natural shadows
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        DEFAULT: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        md: "0 10px 15px -3px rgb(0 0 0 / 0.15), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        lg: "0 20px 25px -5px rgb(0 0 0 / 0.15), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
        xl: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
        "2xl": "0 35px 60px -15px rgb(0 0 0 / 0.3)",
        inner: "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",

        // LIGHT TABLE elevation (spec §4.3): panels cast none, dialogs and
        // prints do. Legacy elevation-N call sites resolve to the same vars.
        dialog: "var(--shadow-md)",
        print: "var(--shadow-print)",
        "elevation-1": "var(--shadow-sm)",
        "elevation-2": "var(--shadow-sm)",
        "elevation-3": "var(--shadow-md)",
        "elevation-4": "var(--shadow-md)",
        "elevation-5": "var(--shadow-lg)",
      },

      // Border radius — LIGHT TABLE scale (8/12/16/20) via tokens.
      borderRadius: {
        none: "0",
        sm: "var(--radius-sm)", // 8px controls
        DEFAULT: "var(--radius-md)", // 12px
        md: "var(--radius-md)", // 12px panels
        lg: "var(--radius-lg)", // 16px photo well, dialogs
        xl: "var(--radius-xl)", // 20px sheets
        "2xl": "var(--radius-xl)", // 20px
        "3xl": "1.5rem", // 24px
        "4xl": "2rem", // 32px
        full: "9999px",
      },

      // Animation durations - Apple-style timing
      transitionDuration: {
        75: "75ms",
        100: "100ms",
        150: "150ms",
        200: "200ms",
        300: "300ms",
        400: "400ms",
        500: "500ms",
        600: "600ms",
        700: "700ms",
        1000: "1000ms",
      },

      // Easing — one curve (spec §4.4); legacy names alias onto it.
      transitionTimingFunction: {
        out: "var(--ease-out)",
        apple: "var(--ease-out)",
        "apple-in": "cubic-bezier(0.4, 0.0, 1, 1)",
        "apple-out": "var(--ease-out)",
      },

      // Custom animations
      keyframes: {
        // Fade animations
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },

        // Slide animations
        "slide-in-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-down": {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-left": {
          "0%": { transform: "translateX(-10px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(10px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },

        // Scale animations
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "scale-out": {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(0.95)", opacity: "0" },
        },

        // Pulse animation
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },

        // Spin animation (for loaders)
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },

        // Shake animation (for errors)
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "10%, 30%, 50%, 70%, 90%": { transform: "translateX(-4px)" },
          "20%, 40%, 60%, 80%": { transform: "translateX(4px)" },
        },

        // Bounce animation
        "bounce-soft": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },

        // Shimmer (for skeleton loaders)
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },

        // Progress bar
        progress: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },

      animation: {
        // Fade
        "fade-in": "fade-in 0.3s ease-out",
        "fade-out": "fade-out 0.3s ease-in",

        // Slide
        "slide-in-up": "slide-in-up 0.3s ease-out",
        "slide-in-down": "slide-in-down 0.3s ease-out",
        "slide-in-left": "slide-in-left 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",

        // Scale
        "scale-in": "scale-in 0.2s ease-out",
        "scale-out": "scale-out 0.2s ease-in",

        // Pulse
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",

        // Spin
        "spin-slow": "spin-slow 3s linear infinite",

        // Shake
        shake: "shake 0.5s ease-in-out",

        // Bounce
        "bounce-soft": "bounce-soft 1s ease-in-out infinite",

        // Shimmer
        shimmer: "shimmer 2s linear infinite",

        // Progress
        progress: "progress 1.5s ease-in-out infinite",
      },

      // Backdrop blur (for glass morphism)
      backdropBlur: {
        xs: "2px",
        sm: "4px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "40px",
        "3xl": "64px",
      },

      // Z-index scale (for layering)
      zIndex: {
        0: "0",
        10: "10",
        20: "20",
        30: "30",
        40: "40",
        50: "50",
        dropdown: "1000",
        sticky: "1020",
        fixed: "1030",
        "modal-backdrop": "1040",
        modal: "1050",
        popover: "1060",
        tooltip: "1070",
      },

      // Max width constraints
      maxWidth: {
        "8xl": "88rem",
        "9xl": "96rem",
      },
    },
  },
  plugins: [
    // Animation delay plugin
    function ({ matchUtilities, theme }) {
      matchUtilities(
        {
          "animation-delay": (value) => ({
            "animation-delay": value,
          }),
        },
        { values: theme("transitionDelay") },
      );
    },
  ],
};
