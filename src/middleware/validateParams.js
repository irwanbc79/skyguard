const { isValidObjectId } = require("../utils/helpers");

/**
 * Middleware: reject request if req.params[idParam] is not a valid MongoDB ObjectId.
 * Use for routes like GET /api/manifests/:id, PUT /api/suspects/:id.
 */
function validateObjectId(idParam = "id") {
  return (req, res, next) => {
    const id = req.params[idParam];
    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        status: "error",
        message: "ID tidak valid",
      });
    }
    next();
  };
}

module.exports = { validateObjectId };
