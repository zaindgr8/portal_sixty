import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This folder is the project root (silences the multiple-lockfiles warning).
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // PropTech uploads (Form A PDFs, phone photos, voice notes) pass through the proxy; the route checks each file's own limit.
  experimental: { proxyClientMaxBodySize: '30mb' },
  // Prompt templates are read from disk at runtime.
  outputFileTracingIncludes: { '/api/proptech/**': ['./prompts/proptech/**', './mappings/**', './extension/**'], '/api/ext/**': ['./mappings/**'] },
};

export default nextConfig;
