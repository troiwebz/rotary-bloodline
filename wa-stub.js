/**
 * wa-stub.js — No-op WhatsApp stub for Vercel / non-WhatsApp environments
 * All functions are safe no-ops that return success-shaped responses.
 */

module.exports = {
  initWhatsApp:      () => {},
  getStatus:         () => ({ ready: false, qr: null }),
  sendBloodAlert:    () => Promise.resolve({ sent: 0, failed: 0 }),
  sendReminderToDonor: () => Promise.resolve(),
  sendWelcomeMessage:  () => Promise.resolve(),
};
