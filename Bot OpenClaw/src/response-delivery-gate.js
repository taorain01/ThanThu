'use strict';

class ResponseDeliveryGate {
  constructor(deliver) {
    this.deliver = deliver;
    this.delivered = false;
    this.promise = null;
  }

  get pending() {
    return this.promise !== null && !this.delivered;
  }

  async deliverOnce(text) {
    if (this.delivered) {
      return false;
    }
    if (!this.promise) {
      this.promise = (async () => {
        await this.deliver(text);
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
};
