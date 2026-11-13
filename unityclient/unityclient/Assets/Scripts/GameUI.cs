using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.InputSystem;
using TMPro;
using Newtonsoft.Json.Linq;

/// <summary>
/// GameUI - the in-arena HUD + chat, built in code. Shows health/shield,
/// ammo, the four ability cooldowns + ultimate charge, a live scoreboard
/// (hold Tab), a kill feed, crosshair and death overlay. Only visible while
/// in a match; the menu flow lives in MenuUI.
/// </summary>
public class GameUI : MonoBehaviour
{
    TMP_Text statusText, ammoText, matchTimerText, killFeedText, scoreboardText, heroText;
    GameObject hpBar, scoreboardPanel, deathOverlay;
    Image hpFill, shieldFill;
    TMP_Text crosshair;
    GameObject chatPanel;
    TMP_Text chatText;
    TMP_InputField chatInput;
    ScrollRect chatScroll;

    // ability cooldown pips
    readonly string[] slots = { "tactical", "special", "movement", "ultimate" };
    readonly string[] slotKeys = { "F", "E", "Shift", "Q" };
    readonly Dictionary<string, float> cooldownEnd = new Dictionary<string, float>();
    readonly Dictionary<string, Image> slotFill = new Dictionary<string, Image>();
    readonly Dictionary<string, TMP_Text> slotLabel = new Dictionary<string, TMP_Text>();

    readonly StringBuilder chatLog = new StringBuilder();
    int chatLines;
    const int MaxChatLines = 100;

    readonly List<(string text, float expire)> killFeed = new List<(string, float)>();
    JArray lastSnapshot;

    public static bool ChatFocused { get; private set; }

    /// <summary>Backward-compatible font accessor (RemotePlayerManager uses this).</summary>
    public static TMP_FontAsset GetFont() => UiKit.GetFont();

    void Awake() => BuildHud();

    void Start()
    {
        var net = GameNetwork.Instance;
        if (net == null) { enabled = false; return; }

        net.OnNotify += msg => SetStatus(msg);
        net.OnChatMessage += (from, name, team, text) => AppendLine($"<b>{name}</b>: {text}");
        net.OnPlayerKilled += (killer, victim) => AddKill($"{killer} ☠ {victim}");
        net.OnMatchStart += _ =>
        {
            cooldownEnd.Clear();
            AddKill("<color=#9cf>Match started - fight!</color>");
        };
        net.OnWorldState += snap => lastSnapshot = snap;
        net.OnCooldownState += (slot, cd, ult) => { if (cd > 0) cooldownEnd[slot] = Time.time + cd / 1000f; };
        net.OnMatchEnd += _ => { };
    }

    void Update()
    {
        var kb = Keyboard.current;
        if (kb == null) return;
        var net = GameNetwork.Instance;
        bool inMatch = net != null && net.inMatch;

        ChatFocused = chatInput != null && chatInput.isFocused;

        // Chat: Enter to focus, C to toggle
        if (!ChatFocused && kb.cKey.wasPressedThisFrame && inMatch) ToggleChat();
        if (!ChatFocused && kb.enterKey.wasPressedThisFrame && inMatch && chatPanel.activeSelf)
        { chatInput.Select(); chatInput.ActivateInputField(); }

        hpBar.SetActive(inMatch);
        ammoText.gameObject.SetActive(inMatch);
        heroText.gameObject.SetActive(inMatch);
        matchTimerText.gameObject.SetActive(inMatch);
        foreach (var img in slotFill.Values) img.transform.parent.gameObject.SetActive(inMatch);
        crosshair.gameObject.SetActive(inMatch && net.alive && Cursor.lockState == CursorLockMode.Locked);
        deathOverlay.SetActive(inMatch && !net.alive);
        if (!inMatch) { scoreboardPanel.SetActive(false); if (chatPanel.activeSelf) chatPanel.SetActive(false); }

        if (!inMatch) { PruneKillFeed(); return; }

        // Health + shield
        hpFill.fillAmount = Mathf.Clamp01(net.hp / (float)Mathf.Max(1, net.maxHp));
        hpFill.color = Color.Lerp(Color.red, Color.green, hpFill.fillAmount);
        shieldFill.fillAmount = Mathf.Clamp01(net.shield / 100f);
        shieldFill.gameObject.SetActive(net.shield > 0);

        // Ammo + hero
        ammoText.text = net.reloading ? "<color=#f80>RELOADING</color>" : $"AMMO {net.ammo}";
        var hero = HeroCatalog.Get(net.hero);
        heroText.text = hero != null ? $"<b>{hero.name}</b>  <size=22>[{hero.passiveName}]</size>" : "";
        heroText.color = hero != null ? hero.Color : Color.white;

        // Ability cooldown pips
        for (int i = 0; i < slots.Length; i++)
        {
            var slot = slots[i];
            if (slot == "ultimate")
            {
                float frac = Mathf.Clamp01(net.ultCharge / 100f);
                slotFill[slot].fillAmount = frac;
                slotFill[slot].color = frac >= 1f ? new Color(1f, 0.85f, 0.2f) : new Color(0.5f, 0.45f, 0.1f);
                slotLabel[slot].text = frac >= 1f ? "Q\n<size=16>READY</size>" : $"Q\n<size=16>{Mathf.FloorToInt(frac * 100)}%</size>";
            }
            else
            {
                float remain = cooldownEnd.TryGetValue(slot, out var end) ? Mathf.Max(0, end - Time.time) : 0;
                slotFill[slot].fillAmount = remain > 0 ? 0.25f : 1f;
                slotFill[slot].color = remain > 0 ? new Color(0.3f, 0.3f, 0.35f) : new Color(0.25f, 0.5f, 0.8f);
                slotLabel[slot].text = remain > 0 ? $"{slotKeys[i]}\n<size=16>{remain:0.0}s</size>" : slotKeys[i];
            }
        }

        // Match timer (from latest WORLD_STATE)
        if (net.timeLeftMs > 0)
        {
            int s = net.timeLeftMs / 1000;
            matchTimerText.text = $"{s / 60}:{s % 60:00}";
        }
        else matchTimerText.text = "";

        // Scoreboard (hold Tab)
        bool showSb = kb.tabKey.isPressed;
        scoreboardPanel.SetActive(showSb);
        if (showSb) RebuildScoreboard();

        PruneKillFeed();
    }

    // ==========================================================
    // Chat
    // ==========================================================

    public void ToggleChat()
    {
        var net = GameNetwork.Instance;
        if (net == null || !net.inMatch) return;
        chatPanel.SetActive(!chatPanel.activeSelf);
    }

    void OnSendClicked()
    {
        var text = chatInput.text;
        if (string.IsNullOrWhiteSpace(text)) return;
        GameNetwork.Instance.SendChat(text);
        chatInput.text = "";
        chatInput.ActivateInputField();
    }

    void AppendLine(string line)
    {
        chatLog.AppendLine(line);
        chatLines++;
        if (chatLines > MaxChatLines)
        {
            var s = chatLog.ToString();
            var nl = s.IndexOf('\n');
            if (nl >= 0) { chatLog.Remove(0, nl + 1); chatLines--; }
        }
        chatText.text = chatLog.ToString();
        Canvas.ForceUpdateCanvases();
        if (chatScroll != null) chatScroll.verticalNormalizedPosition = 0f;
    }

    // ==========================================================
    // Kill feed + scoreboard
    // ==========================================================

    void AddKill(string line)
    {
        killFeed.Add((line, Time.time + 6f));
        if (killFeed.Count > 6) killFeed.RemoveAt(0);
        RenderKillFeed();
    }

    void PruneKillFeed()
    {
        int before = killFeed.Count;
        killFeed.RemoveAll(k => Time.time > k.expire);
        if (killFeed.Count != before) RenderKillFeed();
    }

    void RenderKillFeed() => killFeedText.text = string.Join("\n", killFeed.Select(k => k.text));

    void RebuildScoreboard()
    {
        if (lastSnapshot == null) { scoreboardText.text = "..."; return; }
        var rows = lastSnapshot
            .Select(p => new {
                name = p["displayName"]?.ToString() ?? "?",
                hero = p["hero"]?.ToString() ?? "",
                team = p["team"]?.ToString() ?? "",
                kills = p["score"]?.ToObject<int>() ?? 0,
                deaths = p["deaths"]?.ToObject<int>() ?? 0,
                bot = p["isBot"]?.ToObject<bool>() ?? false
            })
            .OrderByDescending(r => r.kills)
            .ToList();

        var sb = new StringBuilder();
        sb.AppendLine("<b>SCOREBOARD</b>  <size=18>(hold Tab)</size>");
        sb.AppendLine("<size=20>Player               Hero           K / D</size>");
        foreach (var r in rows)
        {
            var h = HeroCatalog.Get(r.hero);
            string hc = h != null ? ColorUtility.ToHtmlStringRGB(h.Color) : "FFFFFF";
            string name = r.bot ? $"<i>{r.name}</i>" : r.name;
            sb.AppendLine($"{name,-20} <color=#{hc}>{(h != null ? h.name : r.hero),-13}</color> {r.kills} / {r.deaths}");
        }
        scoreboardText.text = sb.ToString();
    }

    void SetStatus(string msg) { if (statusText != null) statusText.text = msg; }

    // ==========================================================
    // HUD construction
    // ==========================================================

    void BuildHud()
    {
        var canvas = UiKit.MakeCanvas("HudCanvas", 0);
        var root = canvas.transform;

        statusText = UiKit.MakeText(root, "Status", "", 26, TextAlignmentOptions.TopLeft, Color.yellow);
        UiKit.Anchor(statusText.rectTransform, 0, 1, 1, 1, new Vector2(16, -44), new Vector2(-16, -12));

        heroText = UiKit.MakeText(root, "Hero", "", 26, TextAlignmentOptions.BottomLeft, Color.white);
        UiKit.Anchor(heroText.rectTransform, 0, 0, 0.6f, 0, new Vector2(24, 150), new Vector2(0, 190));

        matchTimerText = UiKit.MakeText(root, "Timer", "", 34, TextAlignmentOptions.Top, Color.white);
        UiKit.Anchor(matchTimerText.rectTransform, 0.5f, 1, 0.5f, 1, new Vector2(-120, -70), new Vector2(120, -14));

        killFeedText = UiKit.MakeText(root, "KillFeed", "", 22, TextAlignmentOptions.TopRight, new Color(1, 0.9f, 0.9f));
        UiKit.Anchor(killFeedText.rectTransform, 0.5f, 1, 1, 1, new Vector2(0, -220), new Vector2(-16, -60));

        // Crosshair
        crosshair = UiKit.MakeText(root, "Crosshair", "+", 36, TextAlignmentOptions.Center, Color.white);
        var cr = crosshair.rectTransform;
        cr.anchorMin = cr.anchorMax = new Vector2(0.5f, 0.5f);
        cr.sizeDelta = new Vector2(50, 50);
        cr.anchoredPosition = Vector2.zero;
        crosshair.gameObject.SetActive(false);

        // Health + shield bar
        hpBar = UiKit.MakePanel(root, "HPBar", new Vector2(0.5f, 0), new Vector2(0.5f, 0),
            new Vector2(0.5f, 0), new Vector2(460, 34), new Color(0.08f, 0.08f, 0.08f, 0.9f));
        hpBar.GetComponent<RectTransform>().anchoredPosition = new Vector2(0, 54);
        hpFill = MakeBarFill(hpBar.transform, Color.green);
        shieldFill = MakeBarFill(hpBar.transform, new Color(0.5f, 0.8f, 1f, 0.9f));
        shieldFill.gameObject.SetActive(false);

        ammoText = UiKit.MakeText(root, "Ammo", "", 30, TextAlignmentOptions.BottomRight, Color.white);
        UiKit.Anchor(ammoText.rectTransform, 1, 0, 1, 0, new Vector2(-240, 54), new Vector2(-24, 100));

        BuildAbilityPips(root);
        BuildScoreboard(root);
        BuildDeathOverlay(root);
        BuildChat(root);
    }

    Image MakeBarFill(Transform parent, Color color)
    {
        var go = new GameObject("Fill", typeof(RectTransform), typeof(Image));
        go.transform.SetParent(parent, false);
        UiKit.Fill(go.GetComponent<RectTransform>());
        var rt = go.GetComponent<RectTransform>();
        rt.offsetMin = new Vector2(4, 4); rt.offsetMax = new Vector2(-4, -4);
        var img = go.GetComponent<Image>();
        img.color = color;
        img.type = Image.Type.Filled;
        img.fillMethod = Image.FillMethod.Horizontal;
        img.fillOrigin = (int)Image.OriginHorizontal.Left;
        return img;
    }

    void BuildAbilityPips(Transform root)
    {
        float size = 72, gap = 12;
        float totalW = slots.Length * size + (slots.Length - 1) * gap;
        for (int i = 0; i < slots.Length; i++)
        {
            var pip = UiKit.MakePanel(root, "Pip_" + slots[i], new Vector2(0.5f, 0), new Vector2(0.5f, 0),
                new Vector2(0.5f, 0), new Vector2(size, size), new Color(0.1f, 0.1f, 0.12f, 0.9f));
            var rt = pip.GetComponent<RectTransform>();
            rt.anchoredPosition = new Vector2(-totalW / 2 + size / 2 + i * (size + gap), 110);

            var fill = new GameObject("Fill", typeof(RectTransform), typeof(Image));
            fill.transform.SetParent(pip.transform, false);
            UiKit.Fill(fill.GetComponent<RectTransform>());
            var img = fill.GetComponent<Image>();
            img.color = new Color(0.25f, 0.5f, 0.8f);
            img.type = Image.Type.Filled;
            img.fillMethod = Image.FillMethod.Vertical;
            img.fillOrigin = (int)Image.OriginVertical.Bottom;
            slotFill[slots[i]] = img;

            var label = UiKit.MakeText(pip.transform, "Key", slotKeys[i], 26, TextAlignmentOptions.Center, Color.white);
            UiKit.Fill(label.rectTransform);
            slotLabel[slots[i]] = label;
        }
    }

    void BuildScoreboard(Transform root)
    {
        scoreboardPanel = UiKit.MakePanel(root, "Scoreboard", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(760, 440), new Color(0.05f, 0.05f, 0.08f, 0.94f));
        scoreboardText = UiKit.MakeText(scoreboardPanel.transform, "SbText", "", 22, TextAlignmentOptions.TopLeft, Color.white);
        var rt = scoreboardText.rectTransform;
        UiKit.Fill(rt);
        rt.offsetMin = new Vector2(24, 20); rt.offsetMax = new Vector2(-24, -20);
        scoreboardPanel.SetActive(false);
    }

    void BuildDeathOverlay(Transform root)
    {
        deathOverlay = new GameObject("DeathOverlay", typeof(RectTransform), typeof(Image));
        deathOverlay.transform.SetParent(root, false);
        UiKit.Fill(deathOverlay.GetComponent<RectTransform>());
        deathOverlay.GetComponent<Image>().color = new Color(0.5f, 0, 0, 0.45f);
        var t = UiKit.MakeText(deathOverlay.transform, "DeathText",
            "YOU DIED\n<size=36>respawning...</size>", 72, TextAlignmentOptions.Center, Color.white);
        UiKit.Fill(t.rectTransform);
        deathOverlay.SetActive(false);
    }

    void BuildChat(Transform root)
    {
        chatPanel = UiKit.MakePanel(root, "ChatPanel", new Vector2(0, 0), new Vector2(0.4f, 0),
            new Vector2(0, 0), new Vector2(0, 260), new Color(0.08f, 0.08f, 0.1f, 0.8f));
        var cp = chatPanel.GetComponent<RectTransform>();
        cp.offsetMin = new Vector2(20, 200); cp.offsetMax = new Vector2(520, 460);

        var scrollGo = new GameObject("ChatScroll", typeof(RectTransform), typeof(Image), typeof(ScrollRect));
        scrollGo.transform.SetParent(chatPanel.transform, false);
        scrollGo.GetComponent<Image>().color = new Color(0.05f, 0.05f, 0.07f, 0.8f);
        var srt = scrollGo.GetComponent<RectTransform>();
        UiKit.Fill(srt); srt.offsetMin = new Vector2(8, 60); srt.offsetMax = new Vector2(-8, -8);

        var viewport = new GameObject("Viewport", typeof(RectTransform), typeof(RectMask2D));
        viewport.transform.SetParent(scrollGo.transform, false);
        UiKit.Fill(viewport.GetComponent<RectTransform>());

        var content = new GameObject("Content", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(viewport.transform, false);
        var crt = content.GetComponent<RectTransform>();
        crt.anchorMin = new Vector2(0, 1); crt.anchorMax = new Vector2(1, 1); crt.pivot = new Vector2(0.5f, 1);
        var vlg = content.GetComponent<VerticalLayoutGroup>();
        vlg.childForceExpandWidth = true; vlg.childControlWidth = true; vlg.childControlHeight = true;
        content.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        chatText = UiKit.MakeText(content.transform, "ChatText", "", 22, TextAlignmentOptions.TopLeft, Color.white);
        UiKit.Fill(chatText.rectTransform);

        chatScroll = scrollGo.GetComponent<ScrollRect>();
        chatScroll.viewport = viewport.GetComponent<RectTransform>();
        chatScroll.content = crt; chatScroll.horizontal = false; chatScroll.vertical = true;

        chatInput = UiKit.MakeInput(chatPanel.transform, "ChatInput", "type a message...");
        var ci = chatInput.GetComponent<RectTransform>();
        ci.anchorMin = new Vector2(0, 0); ci.anchorMax = new Vector2(1, 0); ci.pivot = new Vector2(0, 0);
        ci.offsetMin = new Vector2(8, 8); ci.offsetMax = new Vector2(-96, 52);
        chatInput.onSubmit.AddListener(_ => OnSendClicked());

        var send = UiKit.MakeButton(chatPanel.transform, "Send", "SEND");
        var sb = send.GetComponent<RectTransform>();
        sb.anchorMin = new Vector2(1, 0); sb.anchorMax = new Vector2(1, 0); sb.pivot = new Vector2(1, 0);
        sb.offsetMin = new Vector2(-88, 8); sb.offsetMax = new Vector2(-8, 52);
        send.onClick.AddListener(OnSendClicked);

        chatPanel.SetActive(false);
    }
}
