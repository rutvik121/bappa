/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  headers: async () => [
    {
      // GLB is content-addressed by deploy; cache hard.
      source: '/models/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};
export default nextConfig;
