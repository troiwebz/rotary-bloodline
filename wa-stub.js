/**
 * wa-stub.js — Complete no-op WhatsApp stub for Vercel serverless.
 * Matches every method exported by whatsapp.js so server.js never throws.
 */
module.exports = {
  initWhatsApp:       () => {},
  isReady:            () => false,
  getLastQR:          () => null,
  alertDonors:        () => Promise.resolve(0),
  sendMessage:        () => Promise.resolve(false),
  sendWelcome:        () => Promise.resolve(),
  confirmToRequester: () => Promise.resolve(),
  sendReminderToDonor:() => Promise.resolve(),
  setOnMessage:       () => {},
  initSession:        () => {},
  destroySession:     () => Promise.resolve(),
  clearSessionData:   () => {},
  sessionState:       () => ({ running: false, connected: false, hasQR: false }),
};
