using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json.Linq;
using TMPro;

/// <summary>
/// Marker component so raycasts can resolve a hit collider to a playerId.
/// </summary>
public class RemotePlayerTag : MonoBehaviour
{
    public string playerId;
}

/// <summary>
/// RemotePlayerManager - renders other players + bots from the arena's
/// server WORLD_STATE snapshots. Avatars are hero-tinted, interpolated,
/// show health bars + name tags, and reflect status effects (frost/poison/
/// stun/shield/stealth) purely from snapshot data.
/// </summary>
public class RemotePlayerManager : MonoBehaviour
{
    class RemoteAvatar
    {
        public GameObject go;
        public Renderer bodyRenderer;
        public TextMeshPro nameTag;
        public GameObject barRoot;
        public Transform barFill;
        public Vector3 targetPos;
        public float targetYaw;
        public string displayName;
        public string hero;
        public Color baseColor = Color.gray;
        public int hp = 100, maxHp = 100;
        public bool alive = true;
    }

    readonly Dictionary<string, RemoteAvatar> remotes = new Dictionary<string, RemoteAvatar>();

    [Tooltip("Interpolation speed - higher = snappier")]
    public float lerpSpeed = 12f;

    const float BarWidth = 1.0f;
    const float BarHeight = 0.12f;

    void Start()
    {
        GameNetwork.Instance.OnWorldState += OnWorldState;
        GameNetwork.Instance.OnMatchEnd += _ => ClearAll();
    }

    void OnDestroy()
    {
        if (GameNetwork.Instance != null) GameNetwork.Instance.OnWorldState -= OnWorldState;
    }

    void ClearAll()
    {
        foreach (var av in remotes.Values) if (av.go != null) Destroy(av.go);
        remotes.Clear();
    }

    void OnWorldState(JArray players)
    {
        if (players == null) return;
        var net = GameNetwork.Instance;
        var seen = new HashSet<string>();

        foreach (var p in players)
        {
            var id = p["playerId"]?.ToString();
            if (string.IsNullOrEmpty(id) || id == net.playerId) continue; // skip self
            seen.Add(id);

            var pos = new Vector3(p["x"]?.ToObject<float>() ?? 0, p["y"]?.ToObject<float>() ?? 0, p["z"]?.ToObject<float>() ?? 0);
            var yaw = p["yaw"]?.ToObject<float>() ?? 0;
            var hp = p["hp"]?.ToObject<int>() ?? 100;
            var maxHp = p["maxHp"]?.ToObject<int>() ?? 100;
            var alive = p["alive"]?.ToObject<bool>() ?? true;
            var hero = p["hero"]?.ToString() ?? "";
            var fx = p["fx"];

            if (!remotes.TryGetValue(id, out var av))
            {
                av = SpawnAvatar(id, p["displayName"]?.ToString() ?? id, hero, pos);
                remotes[id] = av;
            }

            if (!av.alive && alive) av.go.transform.position = pos + Vector3.up * 0.9f; // snap on respawn

            av.targetPos = pos;
            av.targetYaw = yaw;
            av.hp = hp; av.maxHp = maxHp;
            av.alive = alive;

            UpdateHealthBar(av);
            ApplyStatus(av, fx);
            av.go.SetActive(alive);
        }

        var gone = new List<string>();
        foreach (var kv in remotes) if (!seen.Contains(kv.Key)) gone.Add(kv.Key);
        foreach (var id in gone) { Destroy(remotes[id].go); remotes.Remove(id); }
    }

    void Update()
    {
        float t = 1f - Mathf.Exp(-lerpSpeed * Time.deltaTime);
        foreach (var av in remotes.Values)
        {
            if (!av.alive) continue;
            av.go.transform.position = Vector3.Lerp(av.go.transform.position, av.targetPos + Vector3.up * 0.9f, t);
            var curYaw = av.go.transform.eulerAngles.y;
            av.go.transform.rotation = Quaternion.Euler(0, Mathf.LerpAngle(curYaw, av.targetYaw, t), 0);
        }
    }

    void LateUpdate()
    {
        var cam = Camera.main;
        if (cam == null) return;
        foreach (var av in remotes.Values)
        {
            if (!av.alive) continue;
            var rot = Quaternion.LookRotation(av.go.transform.position - cam.transform.position);
            if (av.nameTag != null && av.nameTag.gameObject.activeSelf) av.nameTag.transform.rotation = rot;
            if (av.barRoot != null && av.barRoot.activeSelf) av.barRoot.transform.rotation = rot;
        }
    }

    RemoteAvatar SpawnAvatar(string id, string displayName, string hero, Vector3 pos)
    {
        var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.name = "Remote_" + displayName;
        body.transform.SetParent(transform, false);
        body.transform.position = pos + Vector3.up * 0.9f;
        var color = HeroCatalog.ColorFor(hero);
        Paint(body, color);
        body.AddComponent<RemotePlayerTag>().playerId = id;

        var tagGo = new GameObject("NameTag");
        tagGo.transform.SetParent(body.transform, false);
        tagGo.transform.localPosition = new Vector3(0, 1.45f, 0);
        var tag = tagGo.AddComponent<TextMeshPro>();
        var heroInfo = HeroCatalog.Get(hero);
        tag.text = heroInfo != null ? $"{displayName}\n<size=2.5>{heroInfo.name}</size>" : displayName;
        tag.fontSize = 4;
        tag.alignment = TextAlignmentOptions.Center;
        tag.color = Color.white;
        if (UiKit.GetFont() != null) tag.font = UiKit.GetFont();
        tagGo.transform.localScale = Vector3.one * 0.4f;

        var barRoot = new GameObject("HealthBar");
        barRoot.transform.SetParent(body.transform, false);
        barRoot.transform.localPosition = new Vector3(0, 1.15f, 0);

        var bg = GameObject.CreatePrimitive(PrimitiveType.Quad);
        bg.name = "BarBg";
        Destroy(bg.GetComponent<Collider>());
        bg.transform.SetParent(barRoot.transform, false);
        bg.transform.localScale = new Vector3(BarWidth, BarHeight, 1f);
        Paint(bg, new Color(0.1f, 0.1f, 0.1f, 1f), unlit: true);

        var fill = GameObject.CreatePrimitive(PrimitiveType.Quad);
        fill.name = "BarFill";
        Destroy(fill.GetComponent<Collider>());
        fill.transform.SetParent(barRoot.transform, false);
        fill.transform.localPosition = new Vector3(0, 0, -0.01f);
        fill.transform.localScale = new Vector3(BarWidth, BarHeight * 0.8f, 1f);
        Paint(fill, Color.green, unlit: true);

        return new RemoteAvatar
        {
            go = body, bodyRenderer = body.GetComponent<Renderer>(), nameTag = tag,
            barRoot = barRoot, barFill = fill.transform,
            targetPos = pos, targetYaw = 0, displayName = displayName, hero = hero,
            baseColor = color, hp = 100, maxHp = 100, alive = true
        };
    }

    void UpdateHealthBar(RemoteAvatar av)
    {
        if (av.barFill == null) return;
        float frac = Mathf.Clamp01(av.hp / (float)Mathf.Max(1, av.maxHp));
        av.barFill.localScale = new Vector3(BarWidth * frac, BarHeight * 0.8f, 1f);
        av.barFill.localPosition = new Vector3(-BarWidth * (1f - frac) * 0.5f, 0, -0.01f);
        var r = av.barFill.GetComponent<Renderer>();
        if (r != null) r.material.color = Color.Lerp(Color.red, Color.green, frac);
    }

    /// <summary>Reflect compact status flags (fx) in the avatar's look.</summary>
    void ApplyStatus(RemoteAvatar av, JToken fx)
    {
        if (av.bodyRenderer == null) return;
        bool invis = fx?["invis"]?.ToObject<bool>() ?? false;
        bool poison = fx?["poison"]?.ToObject<bool>() ?? false;
        bool slow = fx?["slow"]?.ToObject<bool>() ?? false;
        bool stun = fx?["stun"]?.ToObject<bool>() ?? false;
        bool shield = fx?["shield"]?.ToObject<bool>() ?? false;

        var col = av.baseColor;
        if (poison) col = Color.Lerp(col, new Color(0.3f, 0.9f, 0.2f), 0.5f);
        if (slow) col = Color.Lerp(col, new Color(0.5f, 0.8f, 1f), 0.4f);
        if (stun) col = Color.Lerp(col, Color.yellow, 0.4f);

        if (invis)
        {
            // Stealthed: dim heavily + hide tag/bar (still shootable - collider stays)
            col = new Color(col.r * 0.25f, col.g * 0.25f, col.b * 0.25f, 1f);
            if (av.nameTag != null) av.nameTag.gameObject.SetActive(false);
            if (av.barRoot != null) av.barRoot.SetActive(false);
        }
        else
        {
            if (av.nameTag != null) av.nameTag.gameObject.SetActive(true);
            if (av.barRoot != null) av.barRoot.SetActive(true);
            if (av.nameTag != null) av.nameTag.color = shield ? new Color(0.6f, 0.9f, 1f) : Color.white;
        }
        av.bodyRenderer.material.color = col;
    }

    static void Paint(GameObject go, Color color, bool unlit = false)
    {
        Shader shader;
        if (unlit)
        {
            shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) shader = Shader.Find("Unlit/Color");
        }
        else
        {
            shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
        }
        go.GetComponent<Renderer>().material = new Material(shader) { color = color };
    }
}
