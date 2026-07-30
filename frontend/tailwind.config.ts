import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // TODO: Define design system tokens here
      // colors: { ... },
      // fontFamily: { ... },
      // borderRadius: { ... },
    },
  },
  plugins: [
    // TODO: Add @tailwindcss/forms, @tailwindcss/typography as needed
  ],
};

export default config;
