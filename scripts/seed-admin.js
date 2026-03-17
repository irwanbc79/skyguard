/**
 * Seed script: create / upgrade the superadmin account.
 * Run once on server:  node scripts/seed-admin.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

const ADMIN_EMAIL = "irwan.79@kemenkeu.go.id";
const ADMIN_NAME = "Irwan";
const ADMIN_ROLE = "superadmin";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");

  let user = await User.findOne({ email: ADMIN_EMAIL });
  if (user) {
    user.role = ADMIN_ROLE;
    user.is_verified = true;
    user.is_active = true;
    await user.save();
    console.log(`✓ Existing user upgraded to ${ADMIN_ROLE}: ${ADMIN_EMAIL}`);
  } else {
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const password = await new Promise((resolve) => rl.question("Set password for admin: ", resolve));
    rl.close();
    if (!password || password.length < 8) {
      console.error("Password must be at least 8 characters.");
      process.exit(1);
    }
    user = new User({
      email: ADMIN_EMAIL,
      password,
      full_name: ADMIN_NAME,
      role: ADMIN_ROLE,
      is_verified: true,
      is_active: true,
    });
    await user.save();
    console.log(`✓ Superadmin created: ${ADMIN_EMAIL}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
