import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Server Function arguments are logged by default in development. This
    // app has a sign-in action whose arguments include the submitted password,
    // so the default would print credentials to the terminal. Keep the rest of
    // Next's dev logging; disable only the argument dump.
    serverFunctions: false,
  },
};

export default nextConfig;
