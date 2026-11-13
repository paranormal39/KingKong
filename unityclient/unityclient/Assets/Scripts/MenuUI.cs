using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.InputSystem;
using TMPro;
using Newtonsoft.Json.Linq;

/// <summary>
/// MenuUI - the menu-driven flow (built in code): Login -> Main Menu / mode
/// select -> Matchmaking -> Hero Select -> (in match, menu hidden) -> Results.
/// Drives GameNetwork and spawns / despawns the arena player on match start/end.
/// </summary>
public class MenuUI : MonoBehaviour
{
    enum MenuScreen { Login, Menu, Matchmaking, HeroSelect, Results }
    MenuScreen screen = MenuScreen.Login;

    Canvas canvas;
    GameObject loginPanel, menuPanel, matchmakingPanel, heroSelectPanel, resultsPanel;
    TMP_InputField nameInput;
    TMP_Text toast, mmText, hsTimer, hsRoster, resultsText;
    readonly Dictionary<string, Button> heroButtons = new Dictionary<string, Button>();
    string selectedHero;

    void Awake() => Build();

    void Start()
    {
        var net = GameNetwork.Instance;
        if (net == null) { enabled = false; return; }

        net.OnLoggedIn += () => Show(MenuScreen.Menu);
        net.OnDisconnected += () => Show(MenuScreen.Login);
        net.OnNotify += SetToast;
        net.OnQueueStatus += (q, need, _) =>
        {
            if (screen != MenuScreen.HeroSelect) Show(MenuScreen.Matchmaking);
            if (mmText != null) mmText.text = $"Searching for a match...\n<size=26>{q} / {need} players</size>\n<size=20>(bots will fill the rest)</size>";
        };
        net.OnMatchmakingError += msg => { SetToast(msg); Show(MenuScreen.Menu); };
        net.OnHeroSelectState += OnHeroSelect;
        net.OnMatchStart += OnMatchStart;
        net.OnMatchEnd += OnMatchEnd;

        if (net.IsLoggedIn) Show(MenuScreen.Menu); else Show(MenuScreen.Login);
        nameInput.text = PlayerPrefs.GetString("kk_displayName", "");
    }

    void Update()
    {
        // Esc leaves matchmaking / hero select back to the menu
        var kb = Keyboard.current;
        if (kb != null && kb.escapeKey.wasPressedThisFrame
            && (screen == MenuScreen.Matchmaking || screen == MenuScreen.HeroSelect))
        {
            GameNetwork.Instance.LeaveMatchmaking();
            Show(MenuScreen.Menu);
        }
    }

    // ==========================================================
    // Flow
    // ==========================================================

    void Show(MenuScreen s)
    {
        screen = s;
        canvas.enabled = true;              // visible for every menu screen
        loginPanel.SetActive(s == MenuScreen.Login);
        menuPanel.SetActive(s == MenuScreen.Menu);
        matchmakingPanel.SetActive(s == MenuScreen.Matchmaking);
        heroSelectPanel.SetActive(s == MenuScreen.HeroSelect);
        resultsPanel.SetActive(s == MenuScreen.Results);
    }

    void OnConnectClicked() => GameNetwork.Instance.Login(nameInput.text);

    void OnModeClicked(string modeId) => GameNetwork.Instance.JoinMatchmaking(modeId);

    void OnHeroSelect(JToken state)
    {
        Show(MenuScreen.HeroSelect);
        var roster = state?["roster"] as JArray;
        int timeLeft = state?["timeLeftMs"]?.ToObject<int>() ?? 0;
        if (hsTimer != null) hsTimer.text = $"Lock in your witch - {Mathf.CeilToInt(timeLeft / 1000f)}s";

        if (hsRoster != null && roster != null)
        {
            var sb = new StringBuilder("<b>Lobby</b>\n");
            foreach (var r in roster)
            {
                var name = r["displayName"]?.ToString() ?? "?";
                var hero = r["hero"]?.ToString();
                var locked = r["locked"]?.ToObject<bool>() ?? false;
                var bot = r["isBot"]?.ToObject<bool>() ?? false;
                var h = HeroCatalog.Get(hero);
                string hn = h != null ? h.name : (hero ?? "choosing...");
                string mark = locked ? "<color=#6f6>\u2713</color>" : "<color=#aa6>\u2026</color>";
                sb.AppendLine($"{mark} {(bot ? "<i>" + name + "</i>" : name)} - {hn}");
            }
            hsRoster.text = sb.ToString();
        }
    }

    void OnHeroClicked(string heroId)
    {
        selectedHero = heroId;
        GameNetwork.Instance.SelectHero(heroId);
        foreach (var kv in heroButtons)
        {
            var hero = HeroCatalog.Get(kv.Key);
            var c = hero != null ? hero.Color : Color.gray;
            UiKit.SetButtonColor(kv.Value, kv.Key == heroId ? c : new Color(c.r * 0.4f, c.g * 0.4f, c.b * 0.4f, 1f));
        }
    }

    void OnLockClicked()
    {
        if (string.IsNullOrEmpty(selectedHero)) selectedHero = HeroCatalog.Heroes.FirstOrDefault()?.id;
        GameNetwork.Instance.LockHero(selectedHero);
        SetToast("Locked in - waiting for match...");
    }

    void OnMatchStart(JToken d)
    {
        canvas.enabled = false;                 // hide the whole menu during the match
        GameClientBootstrap.SpawnPlayer(GameNetwork.Instance.spawnPosition);
    }

    void OnMatchEnd(JToken d)
    {
        GameClientBootstrap.DespawnPlayer();
        var winner = d?["winner"];
        var scoreboard = d?["scoreboard"] as JArray;

        var sb = new StringBuilder();
        string wtxt = "Match Over";
        if (winner != null)
        {
            var type = winner["type"]?.ToString();
            var id = winner["id"]?.ToString();
            if (type == "player")
            {
                var row = scoreboard?.FirstOrDefault(r => r["playerId"]?.ToString() == id);
                wtxt = $"Winner: {row?["displayName"]?.ToString() ?? id}";
            }
            else if (type == "team") wtxt = $"Winning side: {id}";
        }
        sb.AppendLine($"<size=42><b>{wtxt}</b></size>\n");
        sb.AppendLine("<size=24>Player               Hero           K / D</size>");
        if (scoreboard != null)
        {
            foreach (var r in scoreboard)
            {
                var h = HeroCatalog.Get(r["hero"]?.ToString());
                string hc = h != null ? ColorUtility.ToHtmlStringRGB(h.Color) : "FFFFFF";
                bool bot = r["isBot"]?.ToObject<bool>() ?? false;
                string nm = r["displayName"]?.ToString() ?? "?";
                sb.AppendLine($"{(bot ? "<i>" + nm + "</i>" : nm),-20} <color=#{hc}>{(h != null ? h.name : ""),-13}</color> {r["kills"]} / {r["deaths"]}");
            }
        }
        if (resultsText != null) resultsText.text = sb.ToString();
        Show(MenuScreen.Results);
    }

    void SetToast(string msg) { if (toast != null) toast.text = msg; }

    // ==========================================================
    // UI construction
    // ==========================================================

    void Build()
    {
        canvas = UiKit.MakeCanvas("MenuCanvas", 20);
        var root = canvas.transform;

        toast = UiKit.MakeText(root, "Toast", "", 24, TextAlignmentOptions.Bottom, Color.yellow);
        UiKit.Anchor(toast.rectTransform, 0, 0, 1, 0, new Vector2(20, 20), new Vector2(-20, 70));

        BuildLogin(root);
        BuildMenu(root);
        BuildMatchmaking(root);
        BuildHeroSelect(root);
        BuildResults(root);
    }

    void BuildLogin(Transform root)
    {
        loginPanel = UiKit.MakePanel(root, "LoginPanel", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(720, 360), new Color(0.1f, 0.1f, 0.12f, 0.95f));
        var title = UiKit.MakeText(loginPanel.transform, "Title", "KINGKONG", 56, TextAlignmentOptions.Center, Color.white);
        UiKit.Anchor(title.rectTransform, 0, 1, 1, 1, new Vector2(0, -90), new Vector2(0, -18));

        nameInput = UiKit.MakeInput(loginPanel.transform, "NameInput", "display name");
        UiKit.Anchor(nameInput.GetComponent<RectTransform>(), 0, 1, 1, 1, new Vector2(30, -178), new Vector2(-30, -100));

        var connect = UiKit.MakeButton(loginPanel.transform, "Connect", "ENTER");
        UiKit.Anchor(connect.GetComponent<RectTransform>(), 0, 1, 1, 1, new Vector2(30, -278), new Vector2(-30, -196));
        connect.onClick.AddListener(OnConnectClicked);
        nameInput.onSubmit.AddListener(_ => OnConnectClicked());
    }

    void BuildMenu(Transform root)
    {
        menuPanel = UiKit.MakePanel(root, "MenuPanel", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(760, 560), new Color(0.1f, 0.1f, 0.12f, 0.95f));
        var title = UiKit.MakeText(menuPanel.transform, "Title", "SELECT MODE", 48, TextAlignmentOptions.Top, Color.white);
        UiKit.Anchor(title.rectTransform, 0, 1, 1, 1, new Vector2(0, -90), new Vector2(0, -20));

        float y = -130;
        foreach (var mode in HeroCatalog.Modes)
        {
            var label = mode.enabled ? $"{mode.name}" : $"{mode.name}   (coming soon)";
            var btn = UiKit.MakeButton(menuPanel.transform, "Mode_" + mode.id, label,
                mode.enabled ? new Color(0.2f, 0.45f, 0.75f) : new Color(0.25f, 0.25f, 0.28f));
            UiKit.Anchor(btn.GetComponent<RectTransform>(), 0, 1, 1, 1, new Vector2(40, y - 72), new Vector2(-40, y));
            y -= 92;
            if (mode.enabled)
            {
                var id = mode.id;
                btn.onClick.AddListener(() => OnModeClicked(id));
            }
            else btn.interactable = false;
        }
    }

    void BuildMatchmaking(Transform root)
    {
        matchmakingPanel = UiKit.MakePanel(root, "MatchmakingPanel", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(720, 320), new Color(0.1f, 0.1f, 0.12f, 0.95f));
        mmText = UiKit.MakeText(matchmakingPanel.transform, "MMText", "Searching...", 30, TextAlignmentOptions.Center, Color.white);
        UiKit.Anchor(mmText.rectTransform, 0, 1, 1, 1, new Vector2(20, -200), new Vector2(-20, -40));

        var cancel = UiKit.MakeButton(matchmakingPanel.transform, "Cancel", "CANCEL", new Color(0.6f, 0.25f, 0.25f));
        UiKit.Anchor(cancel.GetComponent<RectTransform>(), 0, 0, 1, 0, new Vector2(40, 30), new Vector2(-40, 100));
        cancel.onClick.AddListener(() => { GameNetwork.Instance.LeaveMatchmaking(); Show(MenuScreen.Menu); });
    }

    void BuildHeroSelect(Transform root)
    {
        heroSelectPanel = UiKit.MakePanel(root, "HeroSelectPanel", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(1060, 620), new Color(0.08f, 0.08f, 0.11f, 0.96f));
        hsTimer = UiKit.MakeText(heroSelectPanel.transform, "HsTimer", "Choose your witch", 36, TextAlignmentOptions.Top, Color.white);
        UiKit.Anchor(hsTimer.rectTransform, 0, 1, 1, 1, new Vector2(0, -70), new Vector2(0, -16));

        // 4x2 hero grid
        int cols = 4;
        float cardW = 230, cardH = 150, gx = 16, gy = 16, startX = -((cols * cardW + (cols - 1) * gx) / 2) + cardW / 2;
        for (int i = 0; i < HeroCatalog.Heroes.Count; i++)
        {
            var hero = HeroCatalog.Heroes[i];
            int col = i % cols, rowi = i / cols;
            var c = hero.Color;
            var btn = UiKit.MakeButton(heroSelectPanel.transform, "Hero_" + hero.id, "",
                new Color(c.r * 0.4f, c.g * 0.4f, c.b * 0.4f, 1f));
            var rt = btn.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 1);
            rt.pivot = new Vector2(0.5f, 1);
            rt.sizeDelta = new Vector2(cardW, cardH);
            rt.anchoredPosition = new Vector2(startX + col * (cardW + gx), -90 - rowi * (cardH + gy));
            UiKit.SetButtonLabel(btn, $"<b>{hero.name}</b>\n<size=18>{hero.passiveName}</size>\n<size=14>{hero.passiveDesc}</size>");
            var id = hero.id;
            btn.onClick.AddListener(() => OnHeroClicked(id));
            heroButtons[hero.id] = btn;
        }

        hsRoster = UiKit.MakeText(heroSelectPanel.transform, "HsRoster", "", 20, TextAlignmentOptions.TopLeft, Color.white);
        UiKit.Anchor(hsRoster.rectTransform, 0, 0, 0.6f, 0, new Vector2(30, 20), new Vector2(0, 160));

        var lockBtn = UiKit.MakeButton(heroSelectPanel.transform, "Lock", "LOCK IN", new Color(0.2f, 0.6f, 0.3f));
        UiKit.Anchor(lockBtn.GetComponent<RectTransform>(), 1, 0, 1, 0, new Vector2(-280, 30), new Vector2(-30, 110));
        lockBtn.onClick.AddListener(OnLockClicked);
    }

    void BuildResults(Transform root)
    {
        resultsPanel = UiKit.MakePanel(root, "ResultsPanel", new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
            new Vector2(0.5f, 0.5f), new Vector2(880, 620), new Color(0.08f, 0.08f, 0.11f, 0.97f));
        resultsText = UiKit.MakeText(resultsPanel.transform, "ResultsText", "", 24, TextAlignmentOptions.Top, Color.white);
        var rt = resultsText.rectTransform;
        UiKit.Anchor(rt, 0, 1, 1, 1, new Vector2(30, -520), new Vector2(-30, -20));

        var back = UiKit.MakeButton(resultsPanel.transform, "Back", "BACK TO MENU");
        UiKit.Anchor(back.GetComponent<RectTransform>(), 0, 0, 1, 0, new Vector2(40, 30), new Vector2(-40, 100));
        back.onClick.AddListener(() => Show(MenuScreen.Menu));
    }
}

/// <summary>
/// Auto-bootstrap: spawns the backdrop world and the client (network + HUD +
/// menu + remote rendering) on Play. The controllable player is spawned on
/// MATCH_START and despawned on MATCH_END.
/// </summary>
public static class GameClientBootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (Object.FindFirstObjectByType<WorldGenerator>() == null)
            new GameObject("World").AddComponent<WorldGenerator>();

        // Reuse an existing GameNetwork (e.g. one saved in the scene) or make
        // one, then make sure the HUD + menu + remote rendering are all present.
        var net = Object.FindFirstObjectByType<GameNetwork>();
        GameObject go = net != null ? net.gameObject : new GameObject("KingKongClient");
        if (net == null) go.AddComponent<GameNetwork>();

        if (go.GetComponent<GameUI>() == null) go.AddComponent<GameUI>();
        if (go.GetComponent<MenuUI>() == null) go.AddComponent<MenuUI>();
        if (go.GetComponent<RemotePlayerManager>() == null) go.AddComponent<RemotePlayerManager>();
    }

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

    public static void DespawnPlayer()
    {
        var fpc = Object.FindFirstObjectByType<FirstPersonController>();
        if (fpc != null) Object.Destroy(fpc.gameObject);
    }
}
