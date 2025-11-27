import { test, expect } from '@playwright/test';

/**
 * End-to-end API tests for elevation profile generation
 *
 * Tests complete workflow:
 * 1. POST /api/terrain/profile/create - Create profile
 * 2. GET /api/terrain/profile/:profileId - Retrieve results
 * 3. GET /api/terrain/profile/:profileId/csv - Download CSV
 * 4. GET /api/terrain/profile/:profileId/png - Download chart
 * 5. GET /api/terrain/profile/:profileId/chart - Get chart data
 */

test.describe('Elevation Profile API', () => {
  const testProjectId = 'test-project-profile-001';
  const testLineCoordinates = [
    [-122.4194, 37.7749],  // Start point
    [-122.4180, 37.7755],  // Mid point
    [-122.4165, 37.7760]   // End point
  ];
  const testUserId = 'user_test_001';

  test.skip('should complete full elevation profile workflow', async ({ request }) => {
    // Step 1: Create elevation profile
    const createResponse = await request.post('/api/terrain/profile/create', {
      data: {
        projectId: testProjectId,
        lineCoordinates: testLineCoordinates,
        name: 'Test Route A',
        description: 'Test elevation profile',
        sampleInterval: 5.0,
        maxGradeThreshold: 8.0,
        userId: testUserId
      }
    });

    expect(createResponse.ok()).toBeTruthy();
    const createData = await createResponse.json();
    expect(createData.success).toBe(true);
    expect(createData.data.profileId).toBeDefined();

    const profileId = createData.data.profileId;

    // Step 2: Poll for completion (in real scenario)
    // await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Retrieve profile results
    const resultsResponse = await request.get(`/api/terrain/profile/${profileId}`);
    expect(resultsResponse.ok()).toBeTruthy();

    const resultsData = await resultsResponse.json();
    expect(resultsData.success).toBe(true);
    expect(resultsData.data.statistics).toBeDefined();

    // Validate statistics structure
    const stats = resultsData.data.statistics;
    expect(stats.totalDistance).toBeGreaterThan(0);
    expect(stats.elevationGain).toBeGreaterThanOrEqual(0);
    expect(stats.elevationLoss).toBeGreaterThanOrEqual(0);
    expect(stats.maxGradeUphill).toBeGreaterThanOrEqual(0);
    expect(stats.maxGradeDownhill).toBeGreaterThanOrEqual(0);
    expect(stats.excessiveGradePercent).toBeGreaterThanOrEqual(0);
    expect(stats.excessiveGradePercent).toBeLessThanOrEqual(100);

    // Step 4: Download CSV
    const csvResponse = await request.get(`/api/terrain/profile/${profileId}/csv`);
    expect(csvResponse.ok()).toBeTruthy();

    // Step 5: Download PNG chart
    const pngResponse = await request.get(`/api/terrain/profile/${profileId}/png`);
    expect(pngResponse.ok()).toBeTruthy();

    // Step 6: Get chart data JSON
    const chartResponse = await request.get(`/api/terrain/profile/${profileId}/chart`);
    expect(chartResponse.ok()).toBeTruthy();

    // Step 7: Delete profile
    const deleteResponse = await request.delete(`/api/terrain/profile/${profileId}`);
    expect(deleteResponse.ok()).toBeTruthy();
  });

  test.skip('should return error when DEM is missing', async ({ request }) => {
    const response = await request.post('/api/terrain/profile/create', {
      data: {
        projectId: 'project-without-dem',
        lineCoordinates: testLineCoordinates,
        userId: testUserId
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Elevation grid');
    expect(data.details.requiredStory).toBe('1.4 - Elevation Grid Generation');
  });

  test.skip('should return error for invalid line geometry', async ({ request }) => {
    const response = await request.post('/api/terrain/profile/create', {
      data: {
        projectId: testProjectId,
        lineCoordinates: [[-122.4194, 37.7749]],  // Only 1 point
        userId: testUserId
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('at least 2 points');
  });

  test.skip('should return error for missing userId', async ({ request }) => {
    const response = await request.post('/api/terrain/profile/create', {
      data: {
        projectId: testProjectId,
        lineCoordinates: testLineCoordinates
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('userId');
  });

  test.skip('should return 404 for non-existent profile', async ({ request }) => {
    const response = await request.get('/api/terrain/profile/non-existent-profile');

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test.skip('should detect excessive grade sections', async ({ request }) => {
    const resultsResponse = await request.get('/api/terrain/profile/some-profile-id');
    const resultsData = await resultsResponse.json();

    const stats = resultsData.data.statistics;

    if (stats.excessiveGradePercent > 0) {
      // If there are excessive grades, verify the data is reasonable
      expect(stats.excessiveGradeDistance).toBeGreaterThan(0);
      expect(stats.excessiveGradeDistance).toBeLessThanOrEqual(stats.totalDistance);
    }
  });
});
