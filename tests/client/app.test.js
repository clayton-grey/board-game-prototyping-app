/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, waitFor } from '@testing-library/dom';

// We'll mock fetch, localStorage, confirm(), and WebSocket:
let mockFetch;
let mockLocalStorage;
let confirmSpy;
let mockWebSocketInstances = [];
let oldWindowLocation;

/**
 * Override random/date so ephemeral user IDs & session codes are deterministic:
 */
const originalMathRandom = Math.random;
const originalDateNow = Date.now;
let fakeRandomCounter = 0;

// -----------------------------------------------------------------------------
// HELPER to load the client and ensure we have an OPEN WebSocket
// -----------------------------------------------------------------------------
function loadAppAndOpenWebSocket() {
  // 1) Clear & create the minimal DOM
  document.body.innerHTML = `
    <div id="app">
      <!-- Minimal DOM for tests. Include elements the code references. -->
      <div id="project-info" class="floating-panel">
        <span id="project-name" title="Click to edit project name">Test</span>
        <button id="open-project-manager" title="Manage Project">OpenPM</button>
      </div>
      <div id="user-info" class="floating-panel">
        <span id="user-name">Anonymous</span>
        <div id="user-circle"><span id="user-circle-text">?</span></div>
        <div id="login-dropdown" class="floating-panel hidden">
          <form id="loginForm">
            <div><input type="email" id="loginEmail" /></div>
            <div><input type="password" id="loginPassword" /></div>
            <div class="login-actions">
              <a href="#" id="registerLink">Register</a>
              <button type="submit">Login</button>
            </div>
          </form>
        </div>
      </div>
      <ul id="session-users-list" class="floating-panel"></ul>

      <div id="register-modal" class="modal-backdrop hidden">
        <div>
          <div id="register-message"></div>
        </div>
        <form id="registerForm">
          <input type="text" id="regName"/>
          <input type="email" id="regEmail"/>
          <input type="password" id="regPassword"/>
          <input type="password" id="regConfirm"/>
          <button type="submit">Register</button>
          <button type="button" id="registerCancelBtn">Cancel</button>
        </form>
      </div>

      <div id="project-manager-modal" class="modal-backdrop hidden">
        <div class="modal-content floating-panel">
          <div id="messageContainer"></div>
          <button id="loadVersionsBtn">Load Versions</button>
          <button id="saveNewVersionBtn">Save New Version</button>
          <button id="deleteProjectBtn" class="danger">Delete Project</button>
          <button id="close-project-manager">Close</button>
        </div>
      </div>

      <canvas id="gameCanvas"></canvas>

      <div id="undo-redo-controls" class="floating-panel">
        <button id="undo-btn">undo</button>
        <button id="redo-btn">redo</button>
      </div>

      <div id="zoom-controls" class="floating-panel">
        <button id="zoom-out">-</button>
        <span id="zoom-level">100%</span>
        <button id="zoom-in">+</button>
        <button id="frame-all">Frame</button>
      </div>

      <div id="chat-container" class="floating-panel">
        <div id="chat-messages"></div>
        <input type="text" id="chat-input"/>
        <button id="chat-send-btn">Send</button>
      </div>

      <div id="user-action-popover" class="hidden"></div>
    </div>
  `;

  // 2) Actually load the client code
  jest.isolateModules(() => {
    require('../../client/js/app.js');
  });

  // 3) Fire DOMContentLoaded so the app sets up the WebSocket
  window.dispatchEvent(new Event('DOMContentLoaded'));

  // 4) Wait a microtask to let the code create the WebSocket
  //    We return it, along with an async function to “simulate open”
  const wsIndex = mockWebSocketInstances.length - 1;
  const ws = mockWebSocketInstances[wsIndex];
  return ws;
}

/**
 * If you need the WS to actually "open", call this, then wait a tick.
 */
async function simulateWebSocketOpen(ws) {
  if (!ws) return;
  ws.readyState = 1; // OPEN
  if (ws.onopen) ws.onopen();
  // Let any subsequent code run
  await new Promise((r) => setTimeout(r, 0));
  return ws;
}

// -----------------------------------------------------------------------------
// Setup/Teardown
// -----------------------------------------------------------------------------
beforeAll(() => {
  // Mock fetch
  mockFetch = jest.fn();
  global.fetch = mockFetch;

  // Mock localStorage
  mockLocalStorage = (() => {
    let store = {};
    return {
      getItem: jest.fn((key) => (key in store ? store[key] : null)),
      setItem: jest.fn((key, value) => { store[key] = value; }),
      removeItem: jest.fn((key) => { delete store[key]; }),
      clear: jest.fn(() => { store = {}; }),
    };
  })();
  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
  });

  // Mock confirm()
  confirmSpy = jest.spyOn(window, 'confirm');

  // Mock WebSocket
  global.WebSocket = jest.fn((url) => {
    const ws = {
      url,
      readyState: 0, // CONNECTING
      sentMessages: [],
      onopen: null,
      onmessage: null,
      onclose: null,
      send(msg) {
        this.sentMessages.push(msg);
      },
      close() {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose();
      },
    };
    mockWebSocketInstances.push(ws);
    return ws;
  });

  // location
  oldWindowLocation = window.location;
  delete window.location;
  window.location = { ...oldWindowLocation, reload: jest.fn() };

  // Force Math.random and Date.now to be deterministic
  Math.random = () => (fakeRandomCounter++ / 100);
  let dateIncrement = 0;
  Date.now = () => 1000000000000 + (dateIncrement++ * 1000);
});

afterAll(() => {
  // restore location
  window.location = oldWindowLocation;
  confirmSpy.mockRestore();
  // Restore random and date
  Math.random = originalMathRandom;
  Date.now = originalDateNow;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWebSocketInstances.length = 0;
  mockLocalStorage.clear();
  fakeRandomCounter = 0;
});

// -----------------------------------------------------------------------------
// The Tests
// -----------------------------------------------------------------------------
describe('app.js (client-side) final restructure tests', () => {
  let ws;

  beforeEach(async () => {
    // 1) Load the app
    ws = loadAppAndOpenWebSocket();
    // 2) Actually "open" the WS
    await simulateWebSocketOpen(ws);
  });

  test('Anonymous user loads => "join-session" sent on WS open', () => {
    // By now, ws should have 1 message => { type:'join-session' }
    expect(ws.sentMessages.length).toBe(1);
    const joined = JSON.parse(ws.sentMessages[0]);
    expect(joined.type).toBe('join-session');
    expect(joined.userId).toMatch(/^anon_/);
  });

  test('Register success => sets token/user => sends UPGRADE_USER_ID', async () => {
    // Open the login popover => click register => open register modal
    fireEvent.click(document.getElementById('user-info'));
    fireEvent.click(document.getElementById('registerLink'));
    const regModal = document.getElementById('register-modal');
    expect(regModal).not.toHaveClass('hidden');

    fireEvent.change(document.getElementById('regName'), { target:{value:'TestUser'} });
    fireEvent.change(document.getElementById('regEmail'), { target:{value:'test@example.com'} });
    fireEvent.change(document.getElementById('regPassword'), { target:{value:'secret123'} });
    fireEvent.change(document.getElementById('regConfirm'), { target:{value:'secret123'} });

    // successful fetch
    mockFetch.mockResolvedValueOnce({
      ok:true,
      json: async() => ({
        token:'fake_jwt_token',
        user:{ id:999, name:'TestUser', role:'user', email:'test@example.com'}
      })
    });

    fireEvent.submit(document.getElementById('registerForm'));

    // Let the promise resolve
    await waitFor(() => {
      expect(document.getElementById('register-message').textContent)
        .toContain('Registration successful!');
    });

    // Another wait for the code to hide the modal
    await new Promise(r => setTimeout(r, 1100));
    expect(regModal).toHaveClass('hidden');

    // localStorage now has "token","user"
    const calls = mockLocalStorage.setItem.mock.calls;
    expect(calls).toEqual(expect.arrayContaining([
      ['token','fake_jwt_token'],
      ['user', JSON.stringify({
        id:999, name:'TestUser', role:'user', email:'test@example.com'
      })]
    ]));

    // The last WS => "upgrade-user-id"
    const lastWS = ws.sentMessages[ws.sentMessages.length - 1];
    const parsed = JSON.parse(lastWS);
    expect(parsed.type).toBe('upgrade-user-id');
    expect(parsed.newUserId).toBe('user_999');
  });

  test('Register error => shows message', async () => {
    fireEvent.click(document.getElementById('user-info'));
    fireEvent.click(document.getElementById('registerLink'));

    const regMsg = document.getElementById('register-message');
    expect(regMsg.textContent).toBe('');

    mockFetch.mockResolvedValueOnce({
      ok:false,
      status:400,
      json:async() => ({ message:'Email in use' }),
    });

    fireEvent.change(document.getElementById('regEmail'), { target:{value:'exists@example.com'} });
    fireEvent.change(document.getElementById('regPassword'), { target:{value:'abc'} });
    fireEvent.change(document.getElementById('regConfirm'), { target:{value:'abc'} });
    fireEvent.submit(document.getElementById('registerForm'));

    await waitFor(() => {
      expect(regMsg.textContent).toBe('Email in use');
    });
    expect(regMsg.style.color).toBe('red');
  });

  test('Login flow success => sets token + user => upgrade-user-id', async () => {
    fireEvent.click(document.getElementById('user-info'));
    fireEvent.change(document.getElementById('loginEmail'), { target:{value:'login@test.com'} });
    fireEvent.change(document.getElementById('loginPassword'), { target:{value:'pass123'} });

    mockFetch.mockResolvedValueOnce({
      ok:true,
      json: async() => ({
        token:'login_jwt_token',
        user:{ id:123, name:'LoggedInUser', role:'user', email:'login@test.com'}
      })
    });

    fireEvent.submit(document.getElementById('loginForm'));
    await waitFor(() => {
      const calls = mockLocalStorage.setItem.mock.calls;
      expect(calls).toEqual(expect.arrayContaining([
        ['token','login_jwt_token'],
        ['user', JSON.stringify({
          id:123, name:'LoggedInUser', role:'user', email:'login@test.com'
        })]
      ]));
    });

    // The last WS => "upgrade-user-id"
    const lastRaw = ws.sentMessages[ws.sentMessages.length-1];
    const lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('upgrade-user-id');
    expect(lastMsg.newUserId).toBe('user_123');
  });

  test('Logout => confirm => sends DOWNGRADE_USER_ID => clears local token/user', () => {
    // Pre-fill localStorage
    mockLocalStorage.setItem('token','some_token');
    mockLocalStorage.setItem('user', JSON.stringify({ id:50, name:'LoggedInUser', role:'user' }));

    confirmSpy.mockReturnValue(true);

    // Click user-info => triggers confirm => doLogout
    fireEvent.click(document.getElementById('user-info'));
    expect(confirmSpy).toHaveBeenCalledWith('Log out?');

    // The last WS message => "downgrade-user-id"
    const lastRaw = ws.sentMessages[ws.sentMessages.length-1];
    const lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('downgrade-user-id');
    expect(lastMsg.oldUserId).toBe('user_50');

    // localStorage remove
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('token');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('user');
  });

  test('Owner opens project manager => modal is shown, can close', () => {
    // We'll simulate a "session-users" message marking local user as owner:
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'session-users',
        users:[
          { userId:'anon_0', sessionRole:'owner', globalRole:'user' },
        ]
      })
    });

    const pmModal = document.getElementById('project-manager-modal');
    expect(pmModal).toHaveClass('hidden');

    fireEvent.click(document.getElementById('open-project-manager'));
    // Suppose your code sets `pmModal.classList.remove('hidden')` if user is owner
    expect(pmModal).not.toHaveClass('hidden');

    fireEvent.click(document.getElementById('close-project-manager'));
    expect(pmModal).toHaveClass('hidden');
  });

  test('Rename project => ephemeral owner => sends "project-name-change"', () => {
    // ephemeral user is owner
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'session-users',
        users:[
          { userId:'anon_0', sessionRole:'owner', globalRole:'user' }
        ]
      })
    });

    // click project-name => becomes input
    fireEvent.click(document.getElementById('project-name'));
    const input = document.getElementById('edit-project-name');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target:{ value:'RenamedProject'} });
    fireEvent.keyDown(input, { key:'Enter' });

    // The last message => "project-name-change"
    const lastSentRaw = ws.sentMessages[ws.sentMessages.length-1];
    const lastSent = JSON.parse(lastSentRaw);
    expect(lastSent.type).toBe('project-name-change');
    expect(lastSent.newName).toBe('RenamedProject');
  });

  test('Session user popover => ephemeral owner => "Make Editor" & "Kick User"', () => {
    // local is 'anon_0' => owner; plus 'anon_1' => viewer
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'session-users',
        users:[
          { userId:'anon_0', name:'MeOwner', sessionRole:'owner', globalRole:'user'},
          { userId:'anon_1', name:'ViewerGuy', sessionRole:'viewer', globalRole:'user'},
        ]
      })
    });

    const list = document.getElementById('session-users-list');
    expect(list.children.length).toBe(2);
    const secondLi = list.children[1];
    const labelSpan = secondLi.querySelector('span');
    fireEvent.click(labelSpan);

    // The popover => "Make Editor" & "Kick User"
    const popover = document.getElementById('user-action-popover');
    expect(popover).not.toHaveClass('hidden');
    const items = popover.querySelectorAll('.user-action-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Make Editor');
    expect(items[1].textContent).toBe('Kick User');

    // Make Editor => check WS
    fireEvent.click(items[0]);
    const lastRaw = ws.sentMessages[ws.sentMessages.length - 1];
    const lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('make-editor');
    expect(popover).toHaveClass('hidden');
  });

  test('Session user popover => ephemeral editor => hidden popover (cannot manage)', () => {
    // ephemeral user is 'anon_0' => editor
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'session-users',
        users:[
          { userId:'anon_0', sessionRole:'editor', globalRole:'user'},
          { userId:'anon_1', sessionRole:'viewer', globalRole:'user'},
        ]
      })
    });

    const secondLi = document.getElementById('session-users-list').children[1];
    const labelSpan = secondLi.querySelector('span');
    fireEvent.click(labelSpan);

    // since I'm only an editor, the popover remains hidden
    expect(document.getElementById('user-action-popover')).toHaveClass('hidden');
  });

  test('Chat => "chat-message" => appended to #chat-messages', () => {
    fireEvent.change(document.getElementById('chat-input'), { target:{ value:'Hello folks'} });
    fireEvent.click(document.getElementById('chat-send-btn'));

    // Last message => "chat-message"
    const lastRaw = ws.sentMessages[ws.sentMessages.length - 1];
    const lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('chat-message');
    expect(lastMsg.text).toBe('Hello folks');

    // simulate server => appended
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'chat-message',
        message:{ userId:'anon_2', text:'Hi from server'}
      })
    });
    expect(document.getElementById('chat-messages').textContent)
      .toContain('anon_2: Hi from server');
  });

  test('Undo/Redo => clicked => sends "undo" & "redo"', () => {
    fireEvent.click(document.getElementById('undo-btn'));
    let lastRaw = ws.sentMessages[ws.sentMessages.length-1];
    expect(lastRaw).toBeDefined();
    let lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('undo');

    fireEvent.click(document.getElementById('redo-btn'));
    lastRaw = ws.sentMessages[ws.sentMessages.length-1];
    lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('redo');
  });

  test('Undo/Redo => keyboard shortcuts (Ctrl+Z => undo, Ctrl+Shift+Z => redo)', () => {
    // ctrl+z => undo
    fireEvent.keyDown(window, { ctrlKey:true, key:'z' });
    let lastRaw = ws.sentMessages[ws.sentMessages.length - 1];
    let lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('undo');

    // ctrl+shift+z => redo
    fireEvent.keyDown(window, { ctrlKey:true, shiftKey:true, key:'z' });
    lastRaw = ws.sentMessages[ws.sentMessages.length - 1];
    lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('redo');
  });

  test('Zoom in/out & frame-all => updates #zoom-level, no WS messages', () => {
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomLevelSpan = document.getElementById('zoom-level');
    const frameAllBtn = document.getElementById('frame-all');

    // so far => 1 message from "join-session"
    expect(ws.sentMessages.length).toBe(1);
    expect(zoomLevelSpan.textContent).toBe('100%');

    fireEvent.click(zoomInBtn);
    expect(zoomLevelSpan.textContent).not.toBe('100%');

    fireEvent.click(zoomOutBtn);
    expect(zoomLevelSpan.textContent).toMatch(/^\d+%$/);

    fireEvent.click(frameAllBtn);
    // No new WS messages:
    expect(ws.sentMessages.length).toBe(1);
  });

  test('Pressing Delete => sends "element-delete" if local user has shapes locked', () => {
    // Simulate an element #10 locked by local user
    ws.onmessage && ws.onmessage({
      data: JSON.stringify({
        type:'element-state',
        elements: [
          { id:10, shape:'rectangle', x:0,y:0,w:100,h:50, lockedBy:'anon_0' }
        ]
      })
    });

    // Press Delete
    fireEvent.keyDown(window, { key:'Delete' });

    const lastRaw = ws.sentMessages[ws.sentMessages.length - 1];
    const lastMsg = JSON.parse(lastRaw);
    expect(lastMsg.type).toBe('element-delete');
    expect(lastMsg.elementIds).toEqual([10]);
  });
});
