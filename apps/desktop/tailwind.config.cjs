const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.join(__dirname, 'src/renderer/index.html'), path.join(__dirname, 'src/renderer/src/**/*.{ts,tsx}')],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
