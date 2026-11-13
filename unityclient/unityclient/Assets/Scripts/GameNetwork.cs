using System;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using NativeWebSocket;
using Newtonsoft.Json.Linq;

/// <summary>
/// GameNetwork - WebSocket connection to the KingKong arena server.
///
/// Protocol: flat JSON messages where the key name is the message type.
/// Flow: LOGIN -> menu -> JOIN_MATCHMAKING -> hero select -> MATCH_START ->
/// in-arena combat (server-authoritative) -> MATCH_END -> menu.
///
/// Singleton: created by GameClientBootstrap; survives scene loads.
/// </summary>
public class GameNetwork : MonoBehaviour
{
    public static GameNetwork Instance { get; private set; }

    [Header("Server")]
    [Tooltip("ws://localhost:8080 for local dev, wss://your-host for production")]
    public string serverUrl = "ws://localhost:8080";
    public bool autoRestoreSession = true;

    [Header("Identity (filled on login)")]
    public string playerId;
    public string displayName = "Adventurer";
    public string team;         // persistent season team (meta only)
    public string sessionToken;
    public int coins;
    public int loyaltyPoints;

    [Header("Match state")]
    public bool inMatch;
    public string arenaId;
    public string hero;         // chosen hero for the current match
    public string matchTeam;    // in-match side (A/B) or null in FFA
    public Vector3 spawnPosition;
    public int hp = 100;
    public int maxHp = 100;
    public int shield;
    public int ammo;
    public bool reloading;
    public int weaponSlot;
    public bool alive = true;
    public int ultCharge;
    public int score;
    public int timeLeftMs;

    public bool IsConnected => websocket != null && websocket.State == WebSocketState.Open;
    public bool IsLoggedIn { get; private set; }

    WebSocket websocket;

    const string PP_PLAYER_ID = "kk_playerId";
    const string PP_DISPLAY_NAME = "kk_displayName";
    const string PP_SESSION_TOKEN = "kk_sessionToken";

    // ---- Events (fire on the main thread) ----
    public event Action OnConnected;
    public event Action OnDisconnected;
    public event Action OnLoggedIn;
    public event Action<JToken> OnCatalog;
    public event Action<int, int, int> OnQueueStatus;        // queued, needed, waitMs
    public event Action<string> OnMatchmakingError;
    public event Action<JToken> OnHeroSelectState;
    public event Action<JToken> OnMatchStart;
    public event Action<JToken> OnMatchEnd;
    public event Action<JArray> OnWorldState;
    public event Action<int, int> OnAmmoState;               // ammo, weaponSlot
    public event Action<string, int, int> OnCooldownState;   // slot, cooldownMs, ultCharge
    public event Action<int> OnReloading;                    // reloadMs
    public event Action<JToken> OnAbilityUsed;
    public event Action<string, string, string, string> OnChatMessage; // from, name, team, text
    public event Action<int> OnHealthChanged;
    public event Action<string> OnDied;                      // killerName
    public event Action<Vector3> OnRespawned;
    public event Action<string, string> OnPlayerKilled;      // killerName, victimName
    public event Action<JObject> OnRawMessage;
    public event Action<string> OnNotify;

    void Awake()
    {
        if (Instance != null && Instance != this) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        Application.runInBackground = true;
    }

    async void Start() { await Connect(); }

    void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
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
                GetCatalog();
                if (autoRestoreSession) TryRestoreSession();
            };
            websocket.OnError += (e) => { Debug.LogError("[NET] Error: " + e); OnNotify?.Invoke("Connection error: " + e); };
            websocket.OnClose += (code) =>
            {
                IsLoggedIn = false; inMatch = false;
                OnNotify?.Invoke("Disconnected");
                OnDisconnected?.Invoke();
            };
            websocket.OnMessage += (bytes) => HandleMessage(Encoding.UTF8.GetString(bytes));
            await websocket.Connect();
        }
        catch (Exception e)
        {
            Debug.LogError("[NET] Connect failed: " + e.Message);
            OnNotify?.Invoke("Could not reach server: " + e.Message);
        }
    }

    public async Task Disconnect() { if (websocket != null) await websocket.Close(); }
    async void OnApplicationQuit() { await Disconnect(); }

    // ==========================================
    // Outbound
    // ==========================================

    public void Login(string displayNameInput, string explicitPlayerId = null)
    {
        displayName = string.IsNullOrWhiteSpace(displayNameInput) ? "Adventurer" : displayNameInput.Trim();
        PlayerPrefs.SetString(PP_DISPLAY_NAME, displayName);
        SendJson(JsonUtility.ToJson(new LoginMessage { LOGIN = true, playerId = explicitPlayerId, displayName = displayName }));
    }

    public void GetCatalog() => SendJson("{\"GET_CATALOG\":true}");

    public void JoinMatchmaking(string mode) =>
        SendJson(JsonUtility.ToJson(new JoinMessage { JOIN_MATCHMAKING = new ModeData { mode = mode } }));

    public void LeaveMatchmaking() => SendJson("{\"LEAVE_MATCHMAKING\":true}");

    public void SelectHero(string heroId) =>
        SendJson(JsonUtility.ToJson(new HeroMessage { SELECT_HERO = new HeroData { heroId = heroId } }));

    public void LockHero(string heroId) =>
        SendJson(JsonUtility.ToJson(new LockMessage { LOCK_HERO = new HeroData { heroId = heroId } }));

    public void PrimaryFire(string targetId) =>
        SendJson(JsonUtility.ToJson(new FireMessage { PRIMARY_FIRE = new TargetData { targetId = targetId ?? "" } }));

    public void SecondaryFire(string targetId) =>
        SendJson(JsonUtility.ToJson(new SecondaryMessage { SECONDARY_FIRE = new TargetData { targetId = targetId ?? "" } }));

    public void Melee(string targetId) =>
        SendJson(JsonUtility.ToJson(new MeleeMessage { MELEE = new TargetData { targetId = targetId ?? "" } }));

    public void Reload() => SendJson("{\"RELOAD\":true}");

    public void SwitchWeapon(int slot) =>
        SendJson(JsonUtility.ToJson(new SwitchMessage { WEAPON_SWITCH = new SlotIntData { slot = slot } }));

    public void UseAbility(string slot) =>
        SendJson(JsonUtility.ToJson(new AbilityMessage { ABILITY = new SlotData { slot = slot } }));

    public void SendMove(Vector3 position, float yaw, bool crouch)
    {
        if (!IsConnected || !IsLoggedIn || !inMatch) return;
        SendJson(JsonUtility.ToJson(new MoveMessage {
            MOVE = new MoveData { x = position.x, y = position.y, z = position.z, yaw = yaw, crouch = crouch }
        }));
    }

    public void SendChat(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        SendJson(JsonUtility.ToJson(new ChatOutMessage { message = text.Trim() }));
    }

    public void SendJson(string json)
    {
        if (!IsConnected) { OnNotify?.Invoke("Not connected"); return; }
        websocket.SendText(json);
    }

    public void TryRestoreSession()
    {
        var savedId = PlayerPrefs.GetString(PP_PLAYER_ID, "");
        var savedToken = PlayerPrefs.GetString(PP_SESSION_TOKEN, "");
        var savedName = PlayerPrefs.GetString(PP_DISPLAY_NAME, "Adventurer");
        if (string.IsNullOrEmpty(savedId) || string.IsNullOrEmpty(savedToken)) return;
        playerId = savedId; displayName = savedName;
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
        try { json = JObject.Parse(message); }
        catch { Debug.LogWarning("[NET] Non-JSON: " + message); return; }

        if (json.ContainsKey("LOGIN_COMPLETE")) { HandleLogin(json["LOGIN_COMPLETE"], false); return; }
        if (json.ContainsKey("SESSION_RESTORED")) { HandleLogin(json["SESSION_RESTORED"], true); return; }

        if (json.ContainsKey("CATALOG"))
        {
            HeroCatalog.Populate(json["CATALOG"]);
            OnCatalog?.Invoke(json["CATALOG"]);
            return;
        }

        if (json.ContainsKey("QUEUE_STATUS"))
        {
            var d = json["QUEUE_STATUS"];
            OnQueueStatus?.Invoke(d?["queued"]?.ToObject<int>() ?? 0,
                d?["needed"]?.ToObject<int>() ?? 0, d?["waitMs"]?.ToObject<int>() ?? 0);
            return;
        }

        if (json.ContainsKey("MATCHMAKING_ERROR"))
        {
            OnMatchmakingError?.Invoke(json["MATCHMAKING_ERROR"]?["message"]?.ToString() ?? "Matchmaking error");
            return;
        }

        if (json.ContainsKey("HERO_SELECT_STATE")) { OnHeroSelectState?.Invoke(json["HERO_SELECT_STATE"]); return; }

        if (json.ContainsKey("MATCH_START")) { HandleMatchStart(json["MATCH_START"]); return; }

        if (json.ContainsKey("MATCH_END"))
        {
            inMatch = false;
            OnMatchEnd?.Invoke(json["MATCH_END"]);
            return;
        }

        if (json.ContainsKey("AMMO_STATE"))
        {
            var d = json["AMMO_STATE"];
            ammo = d?["ammo"]?.ToObject<int>() ?? ammo;
            weaponSlot = d?["weaponSlot"]?.ToObject<int>() ?? weaponSlot;
            OnAmmoState?.Invoke(ammo, weaponSlot);
            return;
        }

        if (json.ContainsKey("RELOADING"))
        {
            OnReloading?.Invoke(json["RELOADING"]?["reloadMs"]?.ToObject<int>() ?? 0);
            return;
        }

        if (json.ContainsKey("COOLDOWN_STATE"))
        {
            var d = json["COOLDOWN_STATE"];
            ultCharge = d?["ultCharge"]?.ToObject<int>() ?? ultCharge;
            OnCooldownState?.Invoke(d?["slot"]?.ToString() ?? "",
                d?["cooldownMs"]?.ToObject<int>() ?? 0, ultCharge);
            return;
        }

        if (json.ContainsKey("ABILITY_USED")) { OnAbilityUsed?.Invoke(json["ABILITY_USED"]); return; }

        if (json.ContainsKey("CHAT_MESSAGE"))
        {
            var d = json["CHAT_MESSAGE"];
            OnChatMessage?.Invoke(d?["from"]?.ToString() ?? "?", d?["displayName"]?.ToString() ?? "?",
                d?["team"]?.ToString() ?? "", d?["text"]?.ToString() ?? "");
            return;
        }

        if (json.ContainsKey("PLAYER_KILLED"))
        {
            var k = json["PLAYER_KILLED"];
            OnPlayerKilled?.Invoke(k?["killerName"]?.ToString() ?? "?", k?["victimName"]?.ToString() ?? "?");
            return;
        }

        if (json.ContainsKey("WORLD_STATE"))
        {
            timeLeftMs = json["WORLD_STATE"]?["timeLeftMs"]?.ToObject<int>() ?? 0;
            var players = json["WORLD_STATE"]?["players"] as JArray;
            TrackSelfState(players);
            OnWorldState?.Invoke(players);
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
            PlayerPrefs.DeleteKey(PP_SESSION_TOKEN);
            IsLoggedIn = false;
            OnNotify?.Invoke("Session expired - please log in");
            return;
        }

        if (json.ContainsKey("DUPLICATE_CONNECTION"))
        {
            IsLoggedIn = false; inMatch = false;
            OnNotify?.Invoke("Signed in on another device - disconnected");
            return;
        }

        OnRawMessage?.Invoke(json);
    }

    void HandleLogin(JToken d, bool restored)
    {
        playerId = d?["playerId"]?.ToString() ?? playerId;
        team = d?["team"]?.ToString();
        if (!restored) sessionToken = d?["sessionToken"]?.ToString();
        coins = d?["stats"]?["coins"]?.ToObject<int>() ?? 0;
        loyaltyPoints = d?["stats"]?["loyaltyPoints"]?.ToObject<int>() ?? 0;

        if (!string.IsNullOrEmpty(sessionToken)) PlayerPrefs.SetString(PP_SESSION_TOKEN, sessionToken);
        if (!string.IsNullOrEmpty(playerId)) PlayerPrefs.SetString(PP_PLAYER_ID, playerId);

        IsLoggedIn = true;
        OnNotify?.Invoke(restored ? $"Welcome back, {displayName}!" : $"Logged in as {displayName}");
        OnLoggedIn?.Invoke();
    }

    void HandleMatchStart(JToken d)
    {
        arenaId = d?["arenaId"]?.ToString();
        hero = d?["hero"]?.ToString();
        matchTeam = d?["team"]?.ToString();
        spawnPosition = ParseSpawn(d?["spawn"]);
        hp = maxHp; shield = 0; alive = true; ultCharge = 0; score = 0;
        inMatch = true;
        OnMatchStart?.Invoke(d);
    }

    /// <summary>Track our own hp/alive/ammo/shield from the snapshot; fire transitions.</summary>
    void TrackSelfState(JArray players)
    {
        if (players == null || string.IsNullOrEmpty(playerId)) return;
        foreach (var p in players)
        {
            if (p["playerId"]?.ToString() != playerId) continue;

            int newHp = p["hp"]?.ToObject<int>() ?? hp;
            bool newAlive = p["alive"]?.ToObject<bool>() ?? true;
            maxHp = p["maxHp"]?.ToObject<int>() ?? maxHp;
            shield = p["shield"]?.ToObject<int>() ?? shield;
            ammo = p["ammo"]?.ToObject<int>() ?? ammo;
            reloading = p["reloading"]?.ToObject<bool>() ?? false;
            ultCharge = p["ultCharge"]?.ToObject<int>() ?? ultCharge;
            score = p["score"]?.ToObject<int>() ?? score;

            if (newHp != hp) { hp = newHp; OnHealthChanged?.Invoke(hp); }

            if (alive && !newAlive) { alive = false; OnDied?.Invoke(""); }
            else if (!alive && newAlive)
            {
                alive = true; hp = newHp;
                OnRespawned?.Invoke(new Vector3(
                    p["x"]?.ToObject<float>() ?? 0, p["y"]?.ToObject<float>() ?? 0.1f, p["z"]?.ToObject<float>() ?? 0));
            }
            return;
        }
    }

    static Vector3 ParseSpawn(JToken spawn)
    {
        if (spawn == null) return Vector3.zero;
        return new Vector3(spawn["x"]?.ToObject<float>() ?? 0f,
            spawn["y"]?.ToObject<float>() ?? 0.1f, spawn["z"]?.ToObject<float>() ?? 0f);
    }

    // ==========================================
    // Outbound DTOs (JsonUtility, flat JSON)
    // ==========================================
    [Serializable] class LoginMessage { public bool LOGIN; public string playerId; public string displayName; }
    [Serializable] class RestoreSessionMessage { public bool RESTORE_SESSION; public string playerId; public string sessionToken; }
    [Serializable] class ChatOutMessage { public string message; }
    [Serializable] class JoinMessage { public ModeData JOIN_MATCHMAKING; }
    [Serializable] class ModeData { public string mode; }
    [Serializable] class HeroMessage { public HeroData SELECT_HERO; }
    [Serializable] class LockMessage { public HeroData LOCK_HERO; }
    [Serializable] class HeroData { public string heroId; }
    [Serializable] class FireMessage { public TargetData PRIMARY_FIRE; }
    [Serializable] class SecondaryMessage { public TargetData SECONDARY_FIRE; }
    [Serializable] class MeleeMessage { public TargetData MELEE; }
    [Serializable] class TargetData { public string targetId; }
    [Serializable] class SwitchMessage { public SlotIntData WEAPON_SWITCH; }
    [Serializable] class SlotIntData { public int slot; }
    [Serializable] class AbilityMessage { public SlotData ABILITY; }
    [Serializable] class SlotData { public string slot; }
    [Serializable] class MoveMessage { public MoveData MOVE; }
    [Serializable] class MoveData { public float x; public float y; public float z; public float yaw; public bool crouch; }
}
