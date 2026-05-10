const { chromium } = require('playwright');

async function testWebApp() {
  console.log('Starting E2E test...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: [], // No camera permission in headless
  });

  const page = await context.newPage();

  // Capture console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    errors.push(err.message);
  });

  try {
    // Test 1: Page loads
    console.log('Test 1: Loading page...');
    await page.goto('http://localhost:8082/', { waitUntil: 'networkidle' });
    console.log('✓ Page loaded successfully');

    // Test 2: Check title
    console.log('Test 2: Checking title...');
    const title = await page.title();
    if (title.includes('YOLO Pose')) {
      console.log(`✓ Title correct: ${title}`);
    } else {
      console.log(`✗ Title unexpected: ${title}`);
    }

    // Test 3: Check key elements exist
    console.log('Test 3: Checking key elements...');
    const elements = [
      { selector: '#startCamera', name: 'Start Camera button' },
      { selector: '#stopCamera', name: 'Stop Camera button' },
      { selector: '#startDetection', name: 'Start Detection button' },
      { selector: '#stopDetection', name: 'Stop Detection button' },
      { selector: '#videoInput', name: 'Video input' },
      { selector: '#processVideo', name: 'Process Video button' },
      { selector: '#sourceVideo', name: 'Source video' },
      { selector: '#resultCanvas', name: 'Result canvas' },
      { selector: '#confidenceSlider', name: 'Confidence slider' },
      { selector: '#confidenceValue', name: 'Confidence value display' },
    ];

    for (const el of elements) {
      const exists = await page.$(el.selector);
      if (exists) {
        console.log(`  ✓ ${el.name} found`);
      } else {
        console.log(`  ✗ ${el.name} NOT FOUND`);
      }
    }

    // Test 4: API status endpoint
    console.log('Test 4: Testing API status...');
    const response = await page.request.get('http://localhost:8082/api/status');
    const status = await response.json();
    if (status.status === 'running') {
      console.log('  ✓ API status: running');
    } else {
      console.log(`  ✗ API status unexpected: ${JSON.stringify(status)}`);
    }

    // Test 5: Check page for JavaScript errors
    console.log('Test 5: Checking for JS errors...');
    // Click buttons to trigger JS code paths
    await page.click('#startCamera');
    await page.waitForTimeout(500);

    // Check status message
    const statusText = await page.textContent('#status');
    console.log(`  Status after camera click: ${statusText}`);

    // Test 6: Video upload simulation
    console.log('Test 6: Testing upload area exists...');
    const uploadArea = await page.$('#uploadArea');
    if (uploadArea) {
      console.log('  ✓ Upload area found');
    }

    // Test 7: Confidence slider
    console.log('Test 7: Testing confidence slider...');
    const sliderInitialValue = await page.textContent('#confidenceValue');
    console.log(`  Initial confidence: ${sliderInitialValue}`);

    await page.fill('#confidenceSlider', '50');
    await page.waitForTimeout(100);
    const sliderNewValue = await page.textContent('#confidenceValue');
    console.log(`  New confidence after slider change: ${sliderNewValue}`);
    if (sliderNewValue === '0.50') {
      console.log('  ✓ Confidence slider works');
    }

    // Report errors
    if (errors.length > 0) {
      console.log('\n⚠️  Console Errors detected:');
      errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('\n✓ No console errors detected');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testWebApp();