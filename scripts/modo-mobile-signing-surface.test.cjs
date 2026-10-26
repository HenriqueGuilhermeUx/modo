"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inspectMobileSigningSurface } = require("./modo-mobile-signing-surface.cjs");

function fixtures() {
  return {
    app: { expo: {
      version: "1.1.0",
      android: { package: "br.com.alternativeventures.modo", versionCode: 6 },
      ios: { bundleIdentifier: "br.com.alternativeventures.modo", buildNumber: "5" },
      runtimeVersion: { policy: "appVersion" },
      plugins: ["expo-router", ["expo-secure-store", {}]],
      extra: { apiUrl: "https://modo-api-3m10.onrender.com" }
    }},
    eas: { build: { production: {
      android: { buildType: "app-bundle" },
      env: { EXPO_PUBLIC_API_URL: "https://modo-api-3m10.onrender.com" }
    }}, submit: { production: { android: { releaseStatus: "draft" } } } }
  };
}

test("current mobile configuration passes, but never claims signature security or release", () => {
  const { app, eas } = fixtures();
  const r=inspectMobileSigningSurface(app,eas);
  assert.equal(r.configurationStable,true);
  assert.equal(r.mobileReleaseApproved,false);
  assert.equal(r.nativeCryptoAndSigningAudited,false);
  assert.equal(r.installedNodeForgeAuditedAsSafe,false);
});

test("rejects unexpected update-signing or network/transport changes", () => {
  for (const mutate of [
    f => {f.app.expo.updates={codeSigningCertificate:"/tmp/cert"};},
    f => {f.app.expo.updates={codeSigningMetadata:{keyid:"prod"}};},
    f => {f.app.expo.updates={enabled:true};},
    f => {f.app.expo.updates={url:"https://example.com/updates"};},
    f => {f.app.expo.plugins.push("expo-updates");},
    f => {f.app.expo.android.usesCleartextTraffic=true;},
    f => {f.app.expo.ios.infoPlist={NSAppTransportSecurity:{NSAllowsArbitraryLoads:true}};},
  ]) {
    const f=fixtures();mutate(f);
    assert.throws(()=>inspectMobileSigningSurface(f.app,f.eas),
      /OTA_SIGNING_SURFACE|INSECURE_TRANSPORT/);
  }
});

test("rejects release identity drift and unsafe public environment changes", () => {
  let f=fixtures();f.app.expo.android.versionCode=7;
  assert.throws(()=>inspectMobileSigningSurface(f.app,f.eas),/IDENTIFIERS_DRIFT/);
  f=fixtures();f.eas.build.production.env.EXPO_PUBLIC_PRIVATE_KEY="should-never-be-here";
  assert.throws(()=>inspectMobileSigningSurface(f.app,f.eas),/RELEASE_ENVIRONMENT_DRIFT/);
  f=fixtures();f.eas.submit.production.android.releaseStatus="completed";
  assert.throws(()=>inspectMobileSigningSurface(f.app,f.eas),/RELEASE_ENVIRONMENT_DRIFT/);
  assert.throws(()=>inspectMobileSigningSurface(null,{}),/CONFIG_UNAVAILABLE/);
});
