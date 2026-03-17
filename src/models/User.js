const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ALLOWED_DOMAIN = "kemenkeu.go.id";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => v.endsWith(`@${ALLOWED_DOMAIN}`),
        message: `Hanya email @${ALLOWED_DOMAIN} yang diizinkan`,
      },
    },
    password: { type: String, required: true, minlength: 8 },
    full_name: { type: String, required: true, trim: true },
    nip: { type: String, trim: true },
    unit_kerja: { type: String, trim: true },

    role: {
      type: String,
      enum: ["petugas", "admin", "superadmin"],
      default: "petugas",
    },

    is_verified: { type: Boolean, default: false },
    verification_token: { type: String },
    verification_expires: { type: Date },

    reset_token: { type: String },
    reset_expires: { type: Date },

    is_active: { type: Boolean, default: true },
    last_login: { type: Date },
    login_count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.verification_token;
  delete obj.reset_token;
  return obj;
};

userSchema.index({ verification_token: 1 });
userSchema.index({ reset_token: 1 });

module.exports = mongoose.model("User", userSchema);
module.exports.ALLOWED_DOMAIN = ALLOWED_DOMAIN;
