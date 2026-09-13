using System;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using NativeWebSocket;
using Newtonsoft.Json.Linq;

/// <summary>
/// GameNetwork - WebSocket connection to the KingKong game server.
///
/// Protocol: flat JSON messages where the key name is the message type.
/// Outbound messages are sent as UTF-8 JSON text frames; the server replies
/// with binary frames (handled transparently here).
///
/// Singleton: place on a GameObject in the first scene; survives scene loads.
/// </summary>
public class GameNetwork : MonoBehaviour
{
    public static GameNetwork Instance { get; private set; }

    [Header("Server")]
    [Tooltip("ws://localhost:8080 for local dev, wss://your-host for production")]
    public string serverUrl = "ws://localhost:8080";

    [Tooltip("Automatically send RESTORE_SESSION on connect if we have a stored token")]
    public bool autoRestoreSession = true;

    [Header("Player (filled on login)")]
    public string playerId;
    public string displayName = "Adventurer";
    public string team;
    public string sessionToken;
    public int coins;
    public int loyaltyPoints;
    [Tooltip("Server-assigned spawn point from LOGIN_COMPLETE/SESSION_RESTORED")]
    public Vector3 spawnPosition;
    public int hp = 100;
    public bool alive = true;

    public bool IsConnected => websocket != null && websocket.State == WebSocketState.Open;
    public bool IsLoggedIn { get; private set; }

    WebSocket websocket;

    // PlayerPrefs keys
    const string PP_PLAYER_ID = "kk_playerId";
    const string PP_DISPLAY_NAME = "kk_displayName";
    const string PP_SESSION_TOKEN = "kk_sessionToken";

    // ---- Events (all fire on the main thread) ----
    public event Action OnConnected;
    public event Action OnDisconnected;
    public event Action OnLoggedIn;
    /// <summary>from, displayName, team, text</summary>
    public event Action<string, string, string, string> OnChatMessage;
    /// <summary>World-state snapshot: JArray of { playerId, displayName, team, x, y, z, yaw, hp, alive }</summary>
    public event Action<JArray> OnWorldState;
    /// <summary>Own hp changed (value = new hp)</summary>
    public event Action<int> OnHealthChanged;
    /// <summary>We were eliminated (killerName)</summary>
    public event Action<string> OnDied;
    /// <summary>We respawned (server spawn position)</summary>
    public event Action<Vector3> OnRespawned;
    /// <summary>Kill feed: killerName, victimName</summary>
    public event Action<string, string> OnPlayerKilled;
    /// <summary>Raw parsed payload for any message not otherwise handled</summary>
    public event Action<JObject> OnRawMessage;
    /// <summary>Human-readable error/info line for UI display</summary>
    public event Action<string> OnNotify;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        Application.runInBackground = true;
    }

    async void Start()
    {
        await Connect();
    }

    void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        // NativeWebSocket requires this to pump queued callbacks onto the main thread
        websocket?.DispatchMessageQueue();
#endif
    }

    // ==========================================
    // Connection
    // ==========================================

    public async Task Connect()
    {
        if (IsConnected) return;

        try
        {
        websocket = new WebSocket(serverUrl);

        websocket.OnOpen += () =>
        {
            Debug.Log("[NET] Connected to " + serverUrl);
            OnNotify?.Invoke("Connected");
            OnConnected?.Invoke();

            if (autoRestoreSession)
                TryRestoreSession();
        };

        websocket.OnError += (e) =>
        {
            Debug.LogError("[NET] Error: " + e);
            OnNotify?.Invoke("Connection error: " + e);
        };

        websocket.OnClose += (code) =>
        {
            Debug.Log("[NET] Connection closed: " + code);
            IsLoggedIn = false;
            OnNotify?.Invoke("Disconnected");
            OnDisconnected?.Invoke();
        };

        websocket.OnMessage += (bytes) =>
        {
            var message = Encoding.UTF8.GetString(bytes);
            HandleMessage(message);
        };

        await websocket.Connect();
        }
        catch (Exception e)
        {
            Debug.LogError("[NET] Connect failed: " + e.Message);
            OnNotify?.Invoke("Could not reach server: " + e.Message);
        }
    }

    public async Task Disconnect()
    {
        if (websocket != null)
            await websocket.Close();
    }

    async void OnApplicationQuit()
    {
        await Disconnect();
    }

    // ==========================================
    // Outbound messages
    // ==========================================

    /// <summary>
    /// Log in with just a display name - the server generates the playerId.
    /// Optionally pass an explicit playerId (dev/debug).
    /// </summary>
    public void Login(string displayNameInput, string explicitPlayerId = null)
    {
        displayName = string.IsNullOrWhiteSpace(displayNameInput)
            ? "Adventurer"
            : displayNameInput.Trim();
        PlayerPrefs.SetString(PP_DISPLAY_NAME, displayName);

        SendJson(JsonUtility.ToJson(new LoginMessage {
            LOGIN = true, playerId = explicitPlayerId, displayName = displayName
        }));
    }

    /// <summary>Report a shot hit on a remote player.</summary>
    public void SendShoot(string targetId)
    {
        if (!IsConnected || !IsLoggedIn || !alive) return;
        SendJson(JsonUtility.ToJson(new ShootMessage {
            SHOOT = new ShootData { targetId = targetId }
        }));
    }

    /// <summary>Report our position to the server (validated + rebroadcast).</summary>
    public void SendMove(Vector3 position, float yaw)
    {
        if (!IsConnected || !IsLoggedIn) return;
        SendJson(JsonUtility.ToJson(new MoveMessage {
            MOVE = new MoveData { x = position.x, y = position.y, z = position.z, yaw = yaw }
        }));
    }

    /// <summary>Send a chat line to everyone.</summary>
    public void SendChat(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        SendJson(JsonUtility.ToJson(new ChatOutMessage { message = text.Trim() }));
    }

    /// <summary>Send a raw JSON string to the server.</summary>
    public void SendJson(string json)
    {
        if (!IsConnected)
        {
            OnNotify?.Invoke("Not connected");
            return;
        }
        websocket.SendText(json);
    }

    /// <summary>Restore a previous session using the stored session token.</summary>
    public void TryRestoreSession()
    {
        var savedId = PlayerPrefs.GetString(PP_PLAYER_ID, "");
        var savedToken = PlayerPrefs.GetString(PP_SESSION_TOKEN, "");
        var savedName = PlayerPrefs.GetString(PP_DISPLAY_NAME, "Adventurer");

        if (string.IsNullOrEmpty(savedId) || string.IsNullOrEmpty(savedToken))
            return; // no saved session - UI can call Login()

        playerId = savedId;
        displayName = savedName;

        SendJson(JsonUtility.ToJson(new RestoreSessionMessage {
            RESTORE_SESSION = true, playerId = savedId, sessionToken = savedToken
        }));
    }

    // ==========================================
    // Inbound dispatch
    // ==========================================

    void HandleMessage(string message)
    {
        JObject json;
        try
        {
            json = JObject.Parse(message);
        }
        catch
        {
            Debug.LogWarning("[NET] Non-JSON message: " + message);
            return;
        }

        if (json.ContainsKey("LOGIN_COMPLETE"))
        {
            var d = json["LOGIN_COMPLETE"];
            playerId = d?["playerId"]?.ToString() ?? playerId;
            team = d?["team"]?.ToString();
            sessionToken = d?["sessionToken"]?.ToString();
            coins = d?["stats"]?["coins"]?.ToObject<int>() ?? 0;
            loyaltyPoints = d?["stats"]?["loyaltyPoints"]?.ToObject<int>() ?? 0;

            if (!string.IsNullOrEmpty(sessionToken))
                PlayerPrefs.SetString(PP_SESSION_TOKEN, sessionToken);
            if (!string.IsNullOrEmpty(playerId))
                PlayerPrefs.SetString(PP_PLAYER_ID, playerId);

            spawnPosition = ParseSpawn(d?["spawn"]);

            IsLoggedIn = true;
            Debug.Log("[NET] Logged in as " + playerId + " on team " + team);
            OnNotify?.Invoke($"Logged in as {playerId} ({team} team)");
            OnLoggedIn?.Invoke();
            return;
        }

        if (json.ContainsKey("SESSION_RESTORED"))
        {
            var d = json["SESSION_RESTORED"];
            team = d?["team"]?.ToString();
            coins = d?["stats"]?["coins"]?.ToObject<int>() ?? 0;
            loyaltyPoints = d?["stats"]?["loyaltyPoints"]?.ToObject<int>() ?? 0;

            spawnPosition = ParseSpawn(d?["spawn"]);

            IsLoggedIn = true;
            Debug.Log("[NET] Session restored for " + playerId);
            OnNotify?.Invoke($"Welcome back, {playerId}!");
            OnLoggedIn?.Invoke();
            return;
        }

        if (json.ContainsKey("CHAT_MESSAGE"))
        {
            var d = json["CHAT_MESSAGE"];
            OnChatMessage?.Invoke(
                d?["from"]?.ToString() ?? "?",
                d?["displayName"]?.ToString() ?? "?",
                d?["team"]?.ToString() ?? "",
                d?["text"]?.ToString() ?? "");
            return;
        }

        if (json.ContainsKey("LOGIN_ERROR"))
        {
            IsLoggedIn = false;
            PlayerPrefs.DeleteKey(PP_SESSION_TOKEN);
            OnNotify?.Invoke("Login failed: " + (json["LOGIN_ERROR"]?["message"]?.ToString() ?? "unknown"));
            return;
        }

        if (json.ContainsKey("SESSION_RESTORE_ERROR"))
        {
            // Token stale - clear it; UI can show the login field
            PlayerPrefs.DeleteKey(PP_SESSION_TOKEN);
            IsLoggedIn = false;
            OnNotify?.Invoke("Session expired - please log in");
            return;
        }

        if (json.ContainsKey("DUPLICATE_CONNECTION"))
        {
            IsLoggedIn = false;
            OnNotify?.Invoke("Signed in on another device - disconnected");
            return;
        }

        if (json.ContainsKey("PLAYER_KILLED"))
        {
            var k = json["PLAYER_KILLED"];
            var killerName = k?["killerName"]?.ToString() ?? "?";
            var victimName = k?["victimName"]?.ToString() ?? "?";
            OnPlayerKilled?.Invoke(killerName, victimName);
            return;
        }

        if (json.ContainsKey("WORLD_STATE"))
        {
            var players = json["WORLD_STATE"]?["players"] as JArray;
            TrackSelfState(players);
            OnWorldState?.Invoke(players);
            return;
        }

        // Anything else (DAILY_QUEST, MATCH_FOUND, LEADERBOARD, ...) goes to raw listeners
        OnRawMessage?.Invoke(json);
    }

    /// <summary>
    /// Track our own hp/alive from the authoritative snapshot and fire
    /// death/respawn events on transitions.
    /// </summary>
    void TrackSelfState(JArray players)
    {
        if (players == null || string.IsNullOrEmpty(playerId)) return;

        foreach (var p in players)
        {
            if (p["playerId"]?.ToString() != playerId) continue;

            int newHp = p["hp"]?.ToObject<int>() ?? hp;
            bool newAlive = p["alive"]?.ToObject<bool>() ?? true;

            if (newHp != hp)
            {
                hp = newHp;
                OnHealthChanged?.Invoke(hp);
            }

            if (alive && !newAlive)
            {
                alive = false;
                OnDied?.Invoke(""); // killer name comes via PLAYER_KILLED
            }
            else if (!alive && newAlive)
            {
                alive = true;
                hp = newHp;
                var pos = new Vector3(
                    p["x"]?.ToObject<float>() ?? 0,
                    p["y"]?.ToObject<float>() ?? 0.1f,
                    p["z"]?.ToObject<float>() ?? 0);
                OnRespawned?.Invoke(pos);
            }
            return;
        }
    }

    static Vector3 ParseSpawn(JToken spawn)
    {
        if (spawn == null) return Vector3.zero;
        return new Vector3(
            spawn["x"]?.ToObject<float>() ?? 0f,
            spawn["y"]?.ToObject<float>() ?? 0.1f,
            spawn["z"]?.ToObject<float>() ?? 0f);
    }

    // ==========================================
    // Outbound message DTOs
    // ==========================================

    [Serializable]
    class LoginMessage
    {
        public bool LOGIN;
        public string playerId;
        public string displayName;
    }

    [Serializable]
    class RestoreSessionMessage
    {
        public bool RESTORE_SESSION;
        public string playerId;
        public string sessionToken;
    }

    [Serializable]
    class ChatOutMessage
    {
        public string message;
    }

    [Serializable]
    class MoveMessage
    {
        public MoveData MOVE;
    }

    [Serializable]
    class MoveData
    {
        public float x;
        public float y;
        public float z;
        public float yaw;
    }

    [Serializable]
    class ShootMessage
    {
        public ShootData SHOOT;
    }

    [Serializable]
    class ShootData
    {
        public string targetId;
    }
}
