import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:8097";
if (
  process.env.E2E_REAL_POCKETBASE !== "true" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)
)
  throw new Error(
    "Vehicle spin canary requires an explicitly enabled loopback test backend.",
  );
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!username || !password) throw new Error("Test admin credentials required.");
const checks = [];
async function api(
  path,
  { cookie = "", data, method = "GET", expected = 200, headers = {} } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "X-Dealer-Client-Contract": "2026-07-31.v4",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data && !(data instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const value = (res.headers.get("content-type") || "").includes("application/json")
    ? await res.json()
    : await res.arrayBuffer();
  assert.equal(
    res.status,
    expected,
    `${method} ${path}: ${res.status} ${value?.error || ""}`,
  );
  return {
    value,
    cookie: (res.headers.get("set-cookie") || "").match(/dealer_session=([^;]+)/)?.[0],
    headers: res.headers,
  };
}
const admin = (
  await api("/api/app/session", {
    method: "POST",
    data: { authType: "admin_password", username, password },
  })
).cookie;
assert(admin);
const dealer = (
  await api("/api/app/dealers", {
    method: "POST",
    cookie: admin,
    data: { name: "Synthetic Spin QA", requires_approval: true },
  })
).value;
const other = (
  await api("/api/app/dealers", {
    method: "POST",
    cookie: admin,
    data: { name: "Synthetic Other QA", requires_approval: false },
  })
).value;
const createPerson = async (d, name, role) =>
  (
    await api("/api/app/salespeople", {
      method: "POST",
      cookie: admin,
      data: { dealer: d.id, name, role },
    })
  ).value;
const seller = await createPerson(dealer, "Synthetic Seller", "salesperson");
const manager = await createPerson(dealer, "Synthetic Manager", "manager");
const outsider = await createPerson(other, "Synthetic Outsider", "salesperson");
const impersonate = async (p) => {
  const fresh = (
    await api("/api/app/session", {
      method: "POST",
      data: { authType: "admin_password", username, password },
    })
  ).cookie;
  return (
    await api("/api/app/session/impersonate", {
      method: "POST",
      cookie: fresh,
      data: { personId: p.id },
    })
  ).cookie;
};
const sellerCookie = await impersonate(seller),
  managerCookie = await impersonate(manager),
  otherCookie = await impersonate(outsider);
await api("/api/app/vehicle-spins", { expected: 401 });
checks.push("anonymous list denied");
const metadata = {
  vehicle: {
    title: "2024 Synthetic Test Vehicle",
    vin: "",
    stock: "QA",
    mileage: "12345",
    highlights: ["Verified test fixture"],
    caption: "Synthetic local QA only",
  },
  frameCount: 24,
  background: "original",
  reviewedAllAngles: true,
  vehicleOnly: true,
};
await api("/api/app/vehicle-spins", {
  method: "POST",
  cookie: sellerCookie,
  data: { ...metadata, vehicle: { ...metadata.vehicle, caption: "x".repeat(1600) } },
  expected: 400,
});
checks.push("required disclosure cannot overflow saved caption");
const spin = (
  await api("/api/app/vehicle-spins", {
    method: "POST",
    cookie: sellerCookie,
    data: metadata,
    expected: 201,
  })
).value;
assert.equal(spin.state, "uploading");
assert.match(spin.vehicle.caption, /Posted by a Synthetic Spin QA team member/);
checks.push("private project created with required employee disclosure");
await api("/api/collections/vehicle_spins/records/" + spin.id, {
  cookie: sellerCookie,
  expected: 403,
});
checks.push("direct collection access denied");
await api("/api/app/vehicle-spins/" + spin.id, { cookie: otherCookie, expected: 404 });
checks.push("cross dealer denied");
await api("/api/app/vehicle-spins/" + spin.id + "/finish", {
  method: "POST",
  cookie: sellerCookie,
  expected: 409,
});
checks.push("incomplete submission denied");
const jpeg = await readFile(new URL("../e2e/fixtures/spin-angle.jpg", import.meta.url));
for (let i = 0; i < 24; i++) {
  const form = new FormData();
  form.append("image", new Blob([jpeg], { type: "image/jpeg" }), "angle.jpg");
  await api("/api/app/vehicle-spins/" + spin.id + "/frames/" + i, {
    method: "POST",
    cookie: sellerCookie,
    data: form,
  });
}
const ready = (
  await api("/api/app/vehicle-spins/" + spin.id + "/finish", {
    method: "POST",
    cookie: sellerCookie,
  })
).value;
assert.equal(ready.state, "pending");
assert.equal(ready.canDeliver, false);
checks.push("store approval enforced");
await api("/api/app/vehicle-spins/" + spin.id + "/share", {
  method: "POST",
  cookie: sellerCookie,
  expected: 403,
});
await api("/api/app/vehicle-spins/" + spin.id + "/export", {
  method: "POST",
  cookie: sellerCookie,
  expected: 403,
});
checks.push("unapproved link and export denied");
await api("/api/app/vehicle-spins/" + spin.id + "/review", {
  method: "POST",
  cookie: sellerCookie,
  data: { decision: "approved", reviewedAllAngles: true },
  expected: 403,
});
checks.push("seller cannot approve");
const approved = (
  await api("/api/app/vehicle-spins/" + spin.id + "/review", {
    method: "POST",
    cookie: managerCookie,
    data: { decision: "approved", reviewedAllAngles: true },
  })
).value;
assert.equal(approved.canDeliver, true);
checks.push("manager approval unlocks delivery");
const shared = (
  await api("/api/app/vehicle-spins/" + spin.id + "/share", {
    method: "POST",
    cookie: sellerCookie,
  })
).value;
assert.match(shared.linkToken, /^[a-f0-9]{48}$/);
const tokenHeaders = { "X-Vehicle-Spin": shared.linkToken };
await api("/api/public/vehicle-spin", { expected: 404 });
const pub = (await api("/api/public/vehicle-spin", { headers: tokenHeaders })).value;
assert.equal(pub.vehicle.title, metadata.vehicle.title);
assert.equal(pub.linkToken, undefined);
checks.push("public access requires capability and omits owner metadata");
const frame = await api("/api/public/vehicle-spin/frames/0", { headers: tokenHeaders });
assert.match(frame.headers.get("content-type"), /^image\/jpeg/);
assert.match(frame.headers.get("cache-control"), /no-store/);
checks.push("public frame is bounded JPEG with no-store");
const replacement = new FormData();
replacement.append("image", new Blob([jpeg], { type: "image/jpeg" }), "new.jpg");
await api("/api/app/vehicle-spins/" + spin.id + "/frames/0", {
  method: "POST",
  cookie: sellerCookie,
  data: replacement,
  expected: 409,
});
checks.push("reviewed frames immutable");
await api("/api/app/vehicle-spins/" + spin.id + "/export", {
  method: "POST",
  cookie: sellerCookie,
});
checks.push("approved export authorized");
await api("/api/app/vehicle-spins/" + spin.id + "/revoke", {
  method: "POST",
  cookie: sellerCookie,
});
await api("/api/public/vehicle-spin", { headers: tokenHeaders, expected: 404 });
checks.push("revoked link denied");
// An approved spin counts toward first-N review, while a later policy change
// blocks an already-shared no-review spin on both metadata and file routes.
await api("/api/app/dealers/" + dealer.id, {
  method: "PATCH",
  cookie: managerCookie,
  data: { requires_approval: true, approval_policy: { mode: "first_n", firstN: 1 } },
});
const nextSpin = (
  await api("/api/app/vehicle-spins", {
    method: "POST",
    cookie: sellerCookie,
    data: metadata,
    expected: 201,
  })
).value;
const fakeImage = new FormData();
fakeImage.append(
  "image",
  new Blob(["not a jpeg"], { type: "image/jpeg" }),
  "angle.jpg",
);
await api("/api/app/vehicle-spins/" + nextSpin.id + "/frames/0", {
  method: "POST",
  cookie: sellerCookie,
  data: fakeImage,
  expected: 400,
});
checks.push("non-image upload rejected");
for (let i = 0; i < 24; i++) {
  const data = new FormData();
  data.append("image", new Blob([jpeg], { type: "image/jpeg" }), "angle.jpg");
  await api("/api/app/vehicle-spins/" + nextSpin.id + "/frames/" + i, {
    method: "POST",
    cookie: sellerCookie,
    data,
  });
}
const noReview = (
  await api("/api/app/vehicle-spins/" + nextSpin.id + "/finish", {
    method: "POST",
    cookie: sellerCookie,
  })
).value;
assert.equal(noReview.state, "n_a");
checks.push("first-N policy counts only approved work");
const nextLink = (
  await api("/api/app/vehicle-spins/" + nextSpin.id + "/share", {
    method: "POST",
    cookie: sellerCookie,
  })
).value;
const nextHeaders = { "X-Vehicle-Spin": nextLink.linkToken };
await api("/api/public/vehicle-spin", { headers: nextHeaders });
await api("/api/app/dealers/" + dealer.id, {
  method: "PATCH",
  cookie: managerCookie,
  data: { approval_policy: { mode: "always" } },
});
await api("/api/public/vehicle-spin", { headers: nextHeaders, expected: 404 });
await api("/api/public/vehicle-spin/frames/0", { headers: nextHeaders, expected: 404 });
await api("/api/app/vehicle-spins/" + nextSpin.id + "/export", {
  method: "POST",
  cookie: sellerCookie,
  expected: 403,
});
checks.push("current policy blocks existing unapproved links and exports");
await api("/api/app/vehicle-spins/" + nextSpin.id, {
  method: "DELETE",
  cookie: sellerCookie,
});
if (process.env.SPIN_CANARY_KEEP_FIXTURE !== "true") {
  await api("/api/app/vehicle-spins/" + spin.id, {
    method: "DELETE",
    cookie: sellerCookie,
  });
  await api("/api/app/vehicle-spins/" + spin.id, {
    cookie: sellerCookie,
    expected: 404,
  });
  checks.push("delete removes spin");
} else checks.push("approved spin preserved for backup restoration proof");
if (process.env.SPIN_CANARY_REPORT)
  await writeFile(
    process.env.SPIN_CANARY_REPORT,
    JSON.stringify({ passed: true, checks }, null, 2),
  );
console.log(JSON.stringify({ passed: true, checks }, null, 2));
