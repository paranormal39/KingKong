using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json.Linq;
using TMPro;

/// <summary>
/// RemotePlayerManager - renders other players from server WORLD_STATE
/// snapshots. The server is the source of truth: avatars are spawned,
/// moved (interpolated), and removed purely from snapshot diffs.
/// </summary>
public class RemotePlayerManager : MonoBehaviour
{
    class RemoteAvatar
    {
        public GameObject go;
        public TextMeshPro nameTag;
        public Vector3 targetPos;
        public float targetYaw;
        public string displayName;
        public string team;
    }

    readonly Dictionary<string, RemoteAvatar> remotes = new Dictionary<string, RemoteAvatar>();

    [Tooltip("Interpolation speed - higher = snappier")]
    public float lerpSpeed = 12f;

    static readonly Dictionary<string, Color> TeamColors = new Dictionary<string, Color>
    {
        { "red",   new Color(0.86f, 0.08f, 0.24f) },
        { "blue",  new Color(0.12f, 0.56f, 1.00f) },
        { "green", new Color(0.18f, 0.55f, 0.34f) },
    };

    void Start()
    {
        GameNetwork.Instance.OnWorldState += OnWorldState;
    }

    void OnDestroy()
    {
        if (GameNetwork.Instance != null)
            GameNetwork.Instance.OnWorldState -= OnWorldState;
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

            var pos = new Vector3(
                p["x"]?.ToObject<float>() ?? 0,
                p["y"]?.ToObject<float>() ?? 0,
                p["z"]?.ToObject<float>() ?? 0);
            var yaw = p["yaw"]?.ToObject<float>() ?? 0;

            if (!remotes.TryGetValue(id, out var av))
            {
                av = SpawnAvatar(id, p["displayName"]?.ToString() ?? id,
                                 p["team"]?.ToString() ?? "", pos);
                remotes[id] = av;
            }

            av.targetPos = pos;
            av.targetYaw = yaw;
            av.displayName = p["displayName"]?.ToString() ?? av.displayName;
        }

        // Remove players that left the world
        var gone = new List<string>();
        foreach (var kv in remotes)
            if (!seen.Contains(kv.Key)) gone.Add(kv.Key);
        foreach (var id in gone)
        {
            Destroy(remotes[id].go);
            remotes.Remove(id);
        }
    }

    void Update()
    {
        float t = 1f - Mathf.Exp(-lerpSpeed * Time.deltaTime);
        foreach (var av in remotes.Values)
        {
            av.go.transform.position = Vector3.Lerp(av.go.transform.position, av.targetPos, t);
            var curYaw = av.go.transform.eulerAngles.y;
            av.go.transform.rotation = Quaternion.Euler(0, Mathf.LerpAngle(curYaw, av.targetYaw, t), 0);
        }
    }

    void LateUpdate()
    {
        // Billboard name tags toward the active camera
        var cam = Camera.main;
        if (cam == null) return;
        foreach (var av in remotes.Values)
        {
            if (av.nameTag == null) continue;
            av.nameTag.transform.rotation = Quaternion.LookRotation(
                av.nameTag.transform.position - cam.transform.position);
        }
    }

    GameObject SpawnAvatar(string id, string displayName, string team, Vector3 pos)
    {
        var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.name = "Remote_" + displayName;
        body.transform.SetParent(transform, false);
        body.transform.position = pos + Vector3.up * 0.9f; // capsule center
        Paint(body, TeamColors.TryGetValue(team, out var c) ? c : Color.gray);

        // Name tag (3D TMP text above head)
        var tagGo = new GameObject("NameTag");
        tagGo.transform.SetParent(body.transform, false);
        tagGo.transform.localPosition = new Vector3(0, 1.35f, 0);
        var tag = tagGo.AddComponent<TextMeshPro>();
        tag.text = displayName;
        tag.fontSize = 4;
        tag.alignment = TextAlignmentOptions.Center;
        tag.color = Color.white;
        if (GameUI.GetFont() != null) tag.font = GameUI.GetFont();
        tagGo.transform.localScale = Vector3.one * 0.4f;

        return new RemoteAvatar
        {
            go = body,
            nameTag = tag,
            targetPos = pos,
            targetYaw = 0,
            displayName = displayName,
            team = team
        };
    }

    static void Paint(GameObject go, Color color)
    {
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        go.GetComponent<Renderer>().material = new Material(shader) { color = color };
    }
}
