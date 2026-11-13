using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using TMPro;

/// <summary>
/// UiKit - shared programmatic-UI factory used by GameUI (HUD) and MenuUI
/// (menu / matchmaking / hero select / results). Everything is built in code
/// so no scene wiring is required.
/// </summary>
public static class UiKit
{
    static TMP_FontAsset cachedFont;

    /// <summary>
    /// TMP renders nothing without a font asset. Fresh projects often lack
    /// "TMP Essentials", so fall back to a dynamic asset from the built-in font.
    /// </summary>
    public static TMP_FontAsset GetFont()
    {
        if (cachedFont != null) return cachedFont;
        cachedFont = TMP_Settings.defaultFontAsset;
        if (cachedFont == null)
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) font = Resources.GetBuiltinResource<Font>("Arial.ttf");
            if (font != null) cachedFont = TMP_FontAsset.CreateFontAsset(font);
        }
        return cachedFont;
    }

    public static void EnsureEventSystem()
    {
        if (Object.FindFirstObjectByType<EventSystem>() != null) return;
        var es = new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        // A code-created module has no input actions bound, so mouse clicks
        // never reach UI. Assign the built-in default UI actions so buttons work.
        var module = es.GetComponent<InputSystemUIInputModule>();
        if (module != null) module.AssignDefaultActions();
    }

    public static Canvas MakeCanvas(string name, int sortOrder = 0)
    {
        EnsureEventSystem();
        var go = new GameObject(name,
            typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = go.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = sortOrder;
        var scaler = go.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        return canvas;
    }

    public static GameObject MakePanel(Transform parent, string name,
        Vector2 anchorMin, Vector2 anchorMax, Vector2 pivot, Vector2 size, Color color)
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

    public static TMP_Text MakeText(Transform parent, string name, string content,
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

    public static TMP_InputField MakeInput(Transform parent, string name, string placeholder)
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
        Fill(ph.rectTransform);

        var txt = MakeText(textArea.transform, "Text", "", 30, TextAlignmentOptions.MidlineLeft, Color.white);
        Fill(txt.rectTransform);

        var input = go.GetComponent<TMP_InputField>();
        input.textViewport = taRt;
        input.textComponent = txt;
        input.placeholder = ph;
        return input;
    }

    public static Button MakeButton(Transform parent, string name, string label, Color? color = null)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = color ?? new Color(0.2f, 0.45f, 0.75f, 1f);

        var txt = MakeText(go.transform, "Label", label, 32, TextAlignmentOptions.Center, Color.white);
        Fill(txt.rectTransform);
        return go.GetComponent<Button>();
    }

    public static void SetButtonLabel(Button b, string label)
    {
        var t = b.GetComponentInChildren<TMP_Text>();
        if (t != null) t.text = label;
    }

    public static void SetButtonColor(Button b, Color c)
    {
        var img = b.GetComponent<Image>();
        if (img != null) img.color = c;
    }

    /// <summary>Stretch a RectTransform to fill its parent.</summary>
    public static void Fill(RectTransform rt)
    {
        rt.anchorMin = Vector2.zero;
        rt.anchorMax = Vector2.one;
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
    }

    public static void Anchor(RectTransform rt, float minX, float minY, float maxX, float maxY,
        Vector2 offsetMin, Vector2 offsetMax)
    {
        rt.anchorMin = new Vector2(minX, minY);
        rt.anchorMax = new Vector2(maxX, maxY);
        rt.offsetMin = offsetMin;
        rt.offsetMax = offsetMax;
    }

    public static Color ParseHtml(string hex, Color fallback)
    {
        return ColorUtility.TryParseHtmlString(hex, out var c) ? c : fallback;
    }
}
