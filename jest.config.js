module.exports = {
  preset: 'ts-jest',
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: ['./src/**'],
  coverageReporters: ['json-summary', 'text', 'lcov'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
