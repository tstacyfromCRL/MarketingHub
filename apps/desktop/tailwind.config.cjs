const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.join(__dirname, 'src/renderer/index.html'), path.join(__dirname, 'src/renderer/src/**/*.{ts,tsx}')],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ink: '#3B3F4B',
        chrome: '#222530',
        sage: '#6A8B5E',
        mist: '#E1E1E1',
        sand: '#BEB7A4',
        accent: '#7B92C6',
        inktext: '#101419',
        // Existing screens use slate for surfaces and indigo for emphasis. These shades
        // keep that structure, in the quieter Mantis palette.
        slate: {
          50: '#BEB7A4',
          100: '#E1E1E1',
          200: '#E1E1E1',
          300: '#D4D4D4',
          400: '#C4C5C8',
          500: '#9A9CA3',
          600: '#6E727C',
          700: '#4A4E58',
          800: '#32363F',
          900: '#222530',
          950: '#3B3F4B',
        },
        indigo: {
          50: '#EEF1F7',
          100: '#D5DCEC',
          200: '#A8B7D6',
          300: '#7B92C6',
          400: '#8EAA84',
          500: '#7A9A6E',
          600: '#6A8B5E',
          700: '#5C7350',
          800: '#4E6044',
          900: '#3E4C36',
          950: '#2A3326',
        },
      },
    },
  },
  plugins: [],
};
