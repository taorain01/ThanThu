'use strict';

function isNoResponsePlaceholder(value) {
  return /^no response from openclaw\.?$/i.test(String(value || '').trim());
}

class ResponseDeliveryGate {
  constructor(deliver) {
    this.deliver = deliver;
    this.delivered = false;
    this.promise = null;
  }

  get pending() {
    return this.promise !== null && !this.delivered;
  }

  async deliverOnce(text, options = {}) {
    if (this.delivered) {
      return false;
    }
    if (!this.promise) {
      this.promise = (async () => {
        await this.deliver(text, options);
        this.delivered = true;
        return true;
      })();
    }
    try {
      return await this.promise;
    } catch (error) {
      this.promise = null;
      throw error;
    }
  }
}

module.exports = {
  ResponseDeliveryGate,
  isNoResponsePlaceholder,
};
