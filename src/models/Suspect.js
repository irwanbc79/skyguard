const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema({
  action_type: {
    type: String,
    enum: [
      "CREATED",
      "UPDATED",
      "CHECKED",
      "DETAINED",
      "RELEASED",
      "ESCALATED",
      "NOTE",
    ],
    required: true,
  },
  description: { type: String, required: true },
  officer_name: { type: String },
  officer_nip: { type: String },
  created_at: { type: Date, default: Date.now },
});

const suspectSchema = new mongoose.Schema(
  {
    passport_number: {
      type: String,
      required: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    full_name: { type: String, required: true, trim: true },
    nationality: { type: String, trim: true },
    gender: { type: String, enum: ["L", "P", ""], default: "" },
    date_of_birth: { type: Date },
    phone: { type: String, trim: true },

    // Photos (stored as paths)
    passport_photo: { type: String },
    passenger_photo: { type: String },
    additional_photos: [{ type: String }],

    categories: [
      {
        type: String,
        enum: [
          "NARKOTIKA",
          "BEA_CUKAI",
          "PENYELUNDUPAN",
          "CONTRABAND",
          "LAINNYA",
        ],
      },
    ],

    risk_level: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM",
    },

    known_routes: [{ type: String }],
    known_airlines: [{ type: String }],

    description: { type: String },
    notes: { type: String },

    status: {
      type: String,
      enum: ["ACTIVE", "MONITORING", "CLEARED", "ARRESTED"],
      default: "ACTIVE",
      index: true,
    },

    // Cross-check results
    travel_count: { type: Number, default: 0 },
    last_seen: { type: Date },
    last_flight: { type: String },

    // Officer info
    created_by_name: { type: String },
    created_by_nip: { type: String },
    updated_by_name: { type: String },
    updated_by_nip: { type: String },

    // Action history timeline
    actions: [actionSchema],
  },
  {
    timestamps: true,
  },
);

suspectSchema.index({ passport_number: 1, status: 1 });
suspectSchema.index({ full_name: "text" });
suspectSchema.index({ categories: 1 });
suspectSchema.index({ risk_level: 1, status: 1 });

module.exports = mongoose.model("Suspect", suspectSchema);
