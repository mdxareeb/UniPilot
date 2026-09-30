// jest-expo runs the unit tests; moduleNameMapper mirrors the tsconfig `@/*`
// alias so tests import the same paths the app does.
module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
};
