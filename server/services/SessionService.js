// server/services/SessionService.js
import { Session } from './Session.js';

const sessionMap = new Map();

export class SessionService {
  static getSession(code) {
    return sessionMap.get(code) || null;
  }

  static getOrCreateSession(code) {
    let session = this.getSession(code);
    if (!session) {
      session = new Session(code);
      sessionMap.set(code, session);
    }
    return session;
  }

  static removeSession(code) {
    sessionMap.delete(code);
  }
}
