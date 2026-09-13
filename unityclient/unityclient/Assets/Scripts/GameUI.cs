using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
using TMPro;

/// <summary>
/// GameUI - generates the whole connection + chat UI in code.
/// No scene setup required: press Play and the UI appears.
/// </summary>
public class GameUI : MonoBehaviour
{
    // Built programmatically
    TMP_Text statusText;
    GameObject loginPanel;
    TMP_InputField nameInput;
    GameObject chatPanel;
    TMP_Text chatText;
    TMP_InputField chatInput;
    ScrollRect chatScroll;
    GameObject hpBar;
    Image hpFill;
    TMP_Text crosshair;
    GameObject deathOverlay;
    TMP_Text deathText;

    readonly StringBuilder chatLog = new StringBuilder();
    int lineCount = 0;
    const int MaxChatLines = 100;

    TMP_Text chatToggleLabel;
    /// <summary>True while the chat input field has keyboard focus (blocks game input).</summary>
    public static bool ChatFocused { get; private set; }

    static TMP_FontAsset cachedFont;

    /// <summary>
    /// TMP renders nothing without a font asset. Fresh projects often lack
    /// "TMP Essentials", so fall back to a dynamic asset from the built-in font.
    /// Shared with RemotePlayerManager for world-space name tags.
    /// </summary>
    public static TMP_FontAsset GetFont()
    {
        if (cachedFont != null) return cachedFont;

        cachedFont = TMP_Settings.defaultFontAsset;
        if (cachedFont == null)
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null)
                font = Resources.GetBuiltinResource<Font>("Arial.ttf");
            if (font != null)
                cachedFont = TMP_FontAsset.CreateFontAsset(font);
        }
        return cachedFont;
    }

    void Awake()
    {
        BuildUI();
    }

    void Start()
    {
        var net = GameNetwork.Instance;
        if (net == null)
        {
            Debug.LogError("GameUI: no GameNetwork found");
            enabled = false;
            return;
        }

        net.OnConnected += () => SetStatus("Connected - awaiting login", Color.yellow);
        net.OnDisconnected += () =>
        {
            SetStatus("Disconnected", Color.red);
            loginPanel.SetActive(true);
            chatPanel.SetActive(false);
        };
        net.OnLoggedIn += () =>
        {
            SetStatus($"Online - {net.displayName} ({net.playerId}) [{net.team}]", Color.green);
            loginPanel.SetActive(false);
            chatPanel.SetActive(true);
            AppendSystem($"Joined team '{net.team}' - {net.loyaltyPoints} LP, {net.coins} coins");
            GameClientBootstrap.SpawnPlayer(net.spawnPosition);
        };
        net.OnChatMessage += (from, name, team, text) =>
            AppendLine($"<b>{name}</b>: {text}");
        net.OnNotify += msg =>
        {
            SetStatus(msg, Color.yellow);
            AppendSystem(msg);
        };
        net.OnRawMessage += json =>
            AppendSystem($"[{string.Join(", ", json.Properties().Select(p => p.Name))}]");
        net.OnPlayerKilled += (killer, victim) =>
            AppendSystem($"{killer} eliminated {victim}");
        net.OnDied += _ => SetStatus("You were eliminated", Color.red);
        net.OnRespawned += _ => SetStatus($"Online - {net.displayName} ({net.playerId}) [{net.team}]", Color.green);

        nameInput.text = PlayerPrefs.GetString("kk_displayName", "");
    }

    void Update()
    {
        var kb = Keyboard.current;
        if (kb == null) return;

        ChatFocused = chatInput != null && chatInput.isFocused;

        // C toggles chat visibility (unless typing)
        if (!ChatFocused && kb.cKey.wasPressedThisFrame)
            ToggleChat();

        // Enter focuses the chat box (MMO-style)
        if (!ChatFocused && kb.enterKey.wasPressedThisFrame
            && chatPanel.activeSelf && GameNetwork.Instance != null && GameNetwork.Instance.IsLoggedIn)
        {
            chatInput.Select();
            chatInput.ActivateInputField();
        }

        // HUD: health bar, crosshair, death overlay
        var net = GameNetwork.Instance;
        if (net != null && net.IsLoggedIn)
        {
            hpFill.fillAmount = net.hp / 100f;
            hpFill.color = Color.Lerp(Color.red, Color.green, net.hp / 100f);
            hpBar.SetActive(true);
            crosshair.gameObject.SetActive(net.alive && Cursor.lockState == CursorLockMode.Locked);
            deathOverlay.SetActive(!net.alive);
        }
        else
        {
            hpBar.SetActive(false);
            crosshair.gameObject.SetActive(false);
            deathOverlay.SetActive(false);
        }
    }

    /// <summary>Show/hide the chat panel. Also bound to the C key and the CHAT button.</summary>
    public void ToggleChat()
    {
        var net = GameNetwork.Instance;
        if (net == null || !net.IsLoggedIn) return;

        bool show = !chatPanel.activeSelf;
        chatPanel.SetActive(show);
        if (chatToggleLabel != null)
            chatToggleLabel.text = show ? "HIDE CHAT" : "SHOW CHAT";
    }

    // ==========================================================
    // UI callbacks
    // ==========================================================

    void OnConnectClicked()
    {
        GameNetwork.Instance.Login(nameInput.text);
    }

    void OnSendClicked()
    {
        var text = chatInput.text;
        if (string.IsNullOrWhiteSpace(text)) return;
        GameNetwork.Instance.SendChat(text);
        chatInput.text = "";
        chatInput.ActivateInputField();
    }

    void SetStatus(string msg, Color color)
    {
        statusText.text = msg;
        statusText.color = color;
    }

    void AppendSystem(string line) => AppendLine($"<i><color=#888888>{line}</color></i>");

    void AppendLine(string line)
    {
        chatLog.AppendLine(line);
        lineCount++;

        if (lineCount > MaxChatLines)
        {
            var s = chatLog.ToString();
            var firstNewline = s.IndexOf('\n');
            if (firstNewline >= 0)
            {
                chatLog.Remove(0, firstNewline + 1);
                lineCount--;
            }
        }

        chatText.text = chatLog.ToString();
        Canvas.ForceUpdateCanvases();
        chatScroll.verticalNormalizedPosition = 0f;
    }

    // ==========================================================
    // Programmatic UI construction
    // ==========================================================

    void BuildUI()
    {
        EnsureEventSystem();

        // Canvas
        var canvasGo = new GameObject("GameCanvas",
            typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvasGo.transform.SetParent(transform, false);
        var canvas = canvasGo.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasGo.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);

        // --- Status bar (top strip) ---
        statusText = MakeText(canvasGo.transform, "StatusText", "Connecting...",
            42, TextAlignmentOptions.Center, Color.yellow);
        Anchor(statusText.rectTransform, 0, 1, 1, 1, new Vector2(10, -96), new Vector2(-10, -10));

        // --- Chat toggle button (top-right) ---
        var chatToggle = MakeButton(canvasGo.transform, "ChatToggle", "HIDE CHAT");
        var ctRt = chatToggle.GetComponent<RectTransform>();
        ctRt.anchorMin = new Vector2(1, 1);
        ctRt.anchorMax = new Vector2(1, 1);
        ctRt.pivot = new Vector2(1, 1);
        ctRt.offsetMin = new Vector2(-240, -100);
        ctRt.offsetMax = new Vector2(-14, -10);
        chatToggleLabel = chatToggle.GetComponentInChildren<TMP_Text>();
        chatToggle.onClick.AddListener(ToggleChat);

        // --- Login panel (center) ---
        loginPanel = MakePanel(canvasGo.transform, "LoginPanel",
            new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(720, 360), new Color(0.1f, 0.1f, 0.12f, 0.9f));

        var title = MakeText(loginPanel.transform, "Title", "KINGKONG",
            56, TextAlignmentOptions.Center, Color.white);
        Anchor(title.rectTransform, 0, 1, 1, 1, new Vector2(0, -90), new Vector2(0, -18));

        nameInput = MakeInput(loginPanel.transform, "NameInput", "display name");
        Anchor(nameInput.GetComponent<RectTransform>(), 0, 1, 1, 1,
            new Vector2(30, -178), new Vector2(-30, -100));

        var connectBtn = MakeButton(loginPanel.transform, "ConnectButton", "CONNECT");
        Anchor(connectBtn.GetComponent<RectTransform>(), 0, 1, 1, 1,
            new Vector2(30, -278), new Vector2(-30, -196));
        connectBtn.onClick.AddListener(OnConnectClicked);
        nameInput.onSubmit.AddListener(_ => OnConnectClicked());

        // --- Chat panel (bottom half) ---
        chatPanel = MakePanel(canvasGo.transform, "ChatPanel",
            new Vector2(0, 0), new Vector2(1, 0), new Vector2(0.5f, 0),
            new Vector2(-40, 300), new Color(0.08f, 0.08f, 0.1f, 0.85f));
        var chatPanelRt = chatPanel.GetComponent<RectTransform>();
        chatPanelRt.offsetMin = new Vector2(24, 24);   // left/bottom margin
        chatPanelRt.offsetMax = new Vector2(-24, 560);

        // Scroll view for chat log
        var scrollGo = new GameObject("ChatScroll",
            typeof(RectTransform), typeof(Image), typeof(ScrollRect));
        scrollGo.transform.SetParent(chatPanel.transform, false);
        scrollGo.GetComponent<Image>().color = new Color(0.05f, 0.05f, 0.07f, 1f);
        var scrollRt = scrollGo.GetComponent<RectTransform>();
        scrollRt.anchorMin = new Vector2(0, 0);
        scrollRt.anchorMax = new Vector2(1, 1);
        scrollRt.offsetMin = new Vector2(10, 88);   // leave room for input row
        scrollRt.offsetMax = new Vector2(-10, -10);

        var viewport = new GameObject("Viewport", typeof(RectTransform), typeof(RectMask2D));
        viewport.transform.SetParent(scrollGo.transform, false);
        var vpRt = viewport.GetComponent<RectTransform>();
        vpRt.anchorMin = Vector2.zero;
        vpRt.anchorMax = Vector2.one;
        vpRt.offsetMin = Vector2.zero;
        vpRt.offsetMax = Vector2.zero;

        var content = new GameObject("Content", typeof(RectTransform),
            typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(viewport.transform, false);
        var contentRt = content.GetComponent<RectTransform>();
        contentRt.anchorMin = new Vector2(0, 1);
        contentRt.anchorMax = new Vector2(1, 1);
        contentRt.pivot = new Vector2(0.5f, 1);
        contentRt.offsetMin = new Vector2(4, 0);
        contentRt.offsetMax = new Vector2(-4, 0);
        var vlg = content.GetComponent<VerticalLayoutGroup>();
        vlg.childForceExpandWidth = true;
        vlg.childForceExpandHeight = false;
        vlg.childControlWidth = true;
        vlg.childControlHeight = true;
        var fitter = content.GetComponent<ContentSizeFitter>();
        fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        chatText = MakeText(content.transform, "ChatText", "", 30,
            TextAlignmentOptions.TopLeft, Color.white);
        chatText.rectTransform.anchorMin = new Vector2(0, 0);
        chatText.rectTransform.anchorMax = new Vector2(1, 1);
        chatText.rectTransform.offsetMin = Vector2.zero;
        chatText.rectTransform.offsetMax = Vector2.zero;

        chatScroll = scrollGo.GetComponent<ScrollRect>();
        chatScroll.viewport = vpRt;
        chatScroll.content = contentRt;
        chatScroll.horizontal = false;
        chatScroll.vertical = true;

        // Input row: chat input + send button
        chatInput = MakeInput(chatPanel.transform, "ChatInput", "type a message...");
        var ciRt = chatInput.GetComponent<RectTransform>();
        ciRt.anchorMin = new Vector2(0, 0);
        ciRt.anchorMax = new Vector2(1, 0);
        ciRt.pivot = new Vector2(0, 0);
        ciRt.offsetMin = new Vector2(12, 12);
        ciRt.offsetMax = new Vector2(-200, 76);
        chatInput.onSubmit.AddListener(_ => OnSendClicked());

        var sendBtn = MakeButton(chatPanel.transform, "SendButton", "SEND");
        var sbRt = sendBtn.GetComponent<RectTransform>();
        sbRt.anchorMin = new Vector2(1, 0);
        sbRt.anchorMax = new Vector2(1, 0);
        sbRt.pivot = new Vector2(1, 0);
        sbRt.offsetMin = new Vector2(-188, 12);
        sbRt.offsetMax = new Vector2(-12, 76);
        sendBtn.onClick.AddListener(OnSendClicked);

        // --- Crosshair (screen center) ---
        crosshair = MakeText(canvasGo.transform, "Crosshair", "+",
            36, TextAlignmentOptions.Center, Color.white);
        var crossRt = crosshair.rectTransform;
        crossRt.anchorMin = new Vector2(0.5f, 0.5f);
        crossRt.anchorMax = new Vector2(0.5f, 0.5f);
        crossRt.sizeDelta = new Vector2(50, 50);
        crossRt.anchoredPosition = Vector2.zero;
        crosshair.gameObject.SetActive(false);

        // --- Health bar (bottom center, above chat) ---
        hpBar = MakePanel(canvasGo.transform, "HPBar",
            new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(0.5f, 0),
            new Vector2(440, 40), new Color(0.08f, 0.08f, 0.08f, 0.9f));
        hpBar.GetComponent<RectTransform>().anchoredPosition = new Vector2(0, 585);

        var fillGo = new GameObject("Fill", typeof(RectTransform), typeof(Image));
        fillGo.transform.SetParent(hpBar.transform, false);
        var fillRt = fillGo.GetComponent<RectTransform>();
        fillRt.anchorMin = Vector2.zero;
        fillRt.anchorMax = Vector2.one;
        fillRt.offsetMin = new Vector2(4, 4);
        fillRt.offsetMax = new Vector2(-4, -4);
        hpFill = fillGo.GetComponent<Image>();
        hpFill.color = Color.green;
        hpFill.type = Image.Type.Filled;
        hpFill.fillMethod = Image.FillMethod.Horizontal;
        hpFill.fillOrigin = (int)Image.OriginHorizontal.Left;
        hpBar.SetActive(false);

        // --- Death overlay ---
        deathOverlay = new GameObject("DeathOverlay", typeof(RectTransform), typeof(Image));
        deathOverlay.transform.SetParent(canvasGo.transform, false);
        var doRt = deathOverlay.GetComponent<RectTransform>();
        doRt.anchorMin = Vector2.zero;
        doRt.anchorMax = Vector2.one;
        doRt.offsetMin = Vector2.zero;
        doRt.offsetMax = Vector2.zero;
        deathOverlay.GetComponent<Image>().color = new Color(0.5f, 0, 0, 0.45f);

        deathText = MakeText(deathOverlay.transform, "DeathText",
            "YOU DIED\n<size=40>respawning...</size>",
            72, TextAlignmentOptions.Center, Color.white);
        var dtRt = deathText.rectTransform;
        dtRt.anchorMin = Vector2.zero;
        dtRt.anchorMax = Vector2.one;
        dtRt.offsetMin = Vector2.zero;
        dtRt.offsetMax = Vector2.zero;
        deathOverlay.SetActive(false);

        chatPanel.SetActive(false);
    }

    void EnsureEventSystem()
    {
        if (FindFirstObjectByType<EventSystem>() != null) return;
        var es = new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        es.transform.SetParent(transform, false);
    }

    // ---------- widget factories ----------

    static GameObject MakePanel(Transform parent, string name,
        Vector2 anchorMin, Vector2 anchorMax, Vector2 pivot,
        Vector2 size, Color color)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image));
        go.transform.SetParent(parent, false);
        var rt = go.GetComponent<RectTransform>();
        rt.anchorMin = anchorMin;
        rt.anchorMax = anchorMax;
        rt.pivot = pivot;
        rt.sizeDelta = size;
        rt.anchoredPosition = Vector2.zero;
        go.GetComponent<Image>().color = color;
        return go;
    }

    static TMP_Text MakeText(Transform parent, string name, string content,
        int fontSize, TextAlignmentOptions align, Color color)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(TextMeshProUGUI));
        go.transform.SetParent(parent, false);
        var t = go.GetComponent<TextMeshProUGUI>();
        if (GetFont() != null) t.font = GetFont();
        t.text = content;
        t.fontSize = fontSize;
        t.alignment = align;
        t.color = color;
        t.richText = true;
        return t;
    }

    static TMP_InputField MakeInput(Transform parent, string name, string placeholder)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(TMP_InputField));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = new Color(0.16f, 0.16f, 0.2f, 1f);

        var textArea = new GameObject("TextArea", typeof(RectTransform), typeof(RectMask2D));
        textArea.transform.SetParent(go.transform, false);
        var taRt = textArea.GetComponent<RectTransform>();
        taRt.anchorMin = Vector2.zero;
        taRt.anchorMax = Vector2.one;
        taRt.offsetMin = new Vector2(8, 2);
        taRt.offsetMax = new Vector2(-8, -2);

        var ph = MakeText(textArea.transform, "Placeholder", placeholder,
            30, TextAlignmentOptions.MidlineLeft, new Color(1, 1, 1, 0.4f));
        ph.fontStyle = FontStyles.Italic;
        ph.rectTransform.anchorMin = Vector2.zero;
        ph.rectTransform.anchorMax = Vector2.one;
        ph.rectTransform.offsetMin = Vector2.zero;
        ph.rectTransform.offsetMax = Vector2.zero;

        var txt = MakeText(textArea.transform, "Text", "",
            30, TextAlignmentOptions.MidlineLeft, Color.white);
        txt.rectTransform.anchorMin = Vector2.zero;
        txt.rectTransform.anchorMax = Vector2.one;
        txt.rectTransform.offsetMin = Vector2.zero;
        txt.rectTransform.offsetMax = Vector2.zero;

        var input = go.GetComponent<TMP_InputField>();
        input.textViewport = taRt;
        input.textComponent = txt;
        input.placeholder = ph;
        return input;
    }

    static Button MakeButton(Transform parent, string name, string label)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = new Color(0.2f, 0.45f, 0.75f, 1f);

        var txt = MakeText(go.transform, "Label", label,
            32, TextAlignmentOptions.Center, Color.white);
        txt.rectTransform.anchorMin = Vector2.zero;
        txt.rectTransform.anchorMax = Vector2.one;
        txt.rectTransform.offsetMin = Vector2.zero;
        txt.rectTransform.offsetMax = Vector2.zero;
        return go.GetComponent<Button>();
    }

    // ---------- helpers ----------

    static void Anchor(RectTransform rt,
        float minX, float minY, float maxX, float maxY,
        Vector2 offsetMin, Vector2 offsetMax)
    {
        rt.anchorMin = new Vector2(minX, minY);
        rt.anchorMax = new Vector2(maxX, maxY);
        rt.offsetMin = offsetMin;
        rt.offsetMax = offsetMax;
    }
}

/// <summary>
/// Auto-bootstrap: spawns the world and client (network + UI) on Play,
/// so nothing needs to be placed in a scene manually. The controllable
/// player object is spawned on successful login via SpawnPlayer().
/// </summary>
public static class GameClientBootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        // Generated test world
        if (Object.FindFirstObjectByType<WorldGenerator>() == null)
            new GameObject("World").AddComponent<WorldGenerator>();

        // Network + generated UI + remote player rendering
        if (Object.FindFirstObjectByType<GameNetwork>() == null)
        {
            var go = new GameObject("KingKongClient");
            go.AddComponent<GameNetwork>();
            go.AddComponent<GameUI>();
            go.AddComponent<RemotePlayerManager>();
        }
    }

    /// <summary>
    /// Create the first-person player object (called after login).
    /// Safe to call multiple times - only spawns once.
    /// </summary>
    public static FirstPersonController SpawnPlayer(Vector3 position = default)
    {
        var existing = Object.FindFirstObjectByType<FirstPersonController>();
        if (existing != null) return existing;

        if (position == default) position = new Vector3(0, 0.1f, 0);

        var player = new GameObject("Player");
        player.transform.position = position;
        player.AddComponent<CharacterController>();
        return player.AddComponent<FirstPersonController>();
    }
}
