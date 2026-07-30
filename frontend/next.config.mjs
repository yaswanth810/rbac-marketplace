/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router is the default in Next.js 14
  reactStrictMode: true,

  // TODO: configure image domains when remote images are used
  // images: {
  //   domains: ['your-cdn.example.com'],
  // },

  // TODO: add redirects/rewrites to proxy API calls to backend
  // async rewrites() {
  //   return [
  //     { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
  //   ];
  // },
};

export default nextConfig;
