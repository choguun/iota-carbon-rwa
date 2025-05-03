import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  
  // Add redirects configuration
  async redirects() {
    return [
      {
        source: '/',
        destination: '/marketplace',
        permanent: true, // Set to true for permanent redirects (308 status code)
      },
    ]
  },
};

export default nextConfig;
