import * as fs from "fs";
import * as path from "path";
import * as uglify from "uglify-js";
// @ts-ignore
import CleanCSS = require("clean-css");

export namespace X {
  /** 一些配置参数
   * - [注意] 路径问题.start脚本与web-mobile同层级,因此相对路径需要带上web-mobile;cocos在调用资源时没有web-mobile,需要在最后去掉
   */
  const TOOL_DIR_PATH = path.join(__dirname, "../");
  const C = {
    BASE_PATH: path.join(TOOL_DIR_PATH, "../build/web-mobile"), // web-mobile包基础路径
    RES_PATH: path.join(TOOL_DIR_PATH, "../build/web-mobile/res"), // web-mobile包下的res路径
    RES_BASE64_EXTNAME_SET: new Set([
      // 需要使用base64编码的资源后缀(根据项目自行扩充)
      ".png",
      ".jpg",
      ".webp",
      ".mp3",
    ]),
    OUTPUT_RES_JS: path.join(TOOL_DIR_PATH, "dist/res.js"), // 输出文件res.js
    OUTPUT_INDEX_HTML: path.join(TOOL_DIR_PATH, "dist/index.html"), // 输出文件index.html的路径
    INPUT_HTML_FILE: path.join(TOOL_DIR_PATH, "../build/web-mobile/index.html"),
    INPUT_CSS_FILES: [path.join(TOOL_DIR_PATH, "../build/web-mobile/style-mobile.css")],
    INPUT_JS_FILES: [
      // !注意顺序, 先输出再输入
      path.join(TOOL_DIR_PATH, "dist/res.js"),
      path.join(TOOL_DIR_PATH, "../build/web-mobile/cocos2d-js-min.js"),
      path.join(TOOL_DIR_PATH, "../build/web-mobile/main.js"),
      path.join(TOOL_DIR_PATH, "../build/web-mobile/src/settings.js"),
      path.join(TOOL_DIR_PATH, "../build/web-mobile/src/project.js"),
      path.join(TOOL_DIR_PATH, "src/new-res-loader.js"),
      path.join(TOOL_DIR_PATH, "src/game-start.js"),
    ],
  };

  /**
   * 读取文件内容
   * - 特定后缀返回base64编码后字符串,否则直接返回文件内容字符串
   * @param filepath
   */
  function get_file_content(filepath: string): string {
    let file = fs.readFileSync(filepath);
    return C.RES_BASE64_EXTNAME_SET.has(path.extname(filepath)) ? file.toString("base64") : file.toString();
  }

  /**
   * 获取路径下的所有子文件路径(深度遍历)
   * @param filepath
   */
  function get_all_child_file(filepath: string): string[] {
    let children = [filepath];
    for (;;) {
      // 如果都是file类型的,则跳出循环
      if (children.every((v) => fs.statSync(v).isFile())) {
        break;
      }
      // 如果至少有1个directroy类型,则删除这一项,并加入其子项
      children.forEach((child, i) => {
        if (fs.statSync(child).isDirectory()) {
          delete children[i];
          let child_children = fs.readdirSync(child).map((v) => `${child}/${v}`);
          children.push(...child_children);
        }
      });
    }
    return children;
  }

  /**
   * 将所有res路径下的资源转化为res.js
   * - 存储方式为:res-url(注意是相对的),res文件内容字符串或编码
   */
  function write_resjs() {
    // 读取并写入到一个对象中
    let res_object = {};
    get_all_child_file(C.RES_PATH).forEach((path) => {
      // 注意,存储时删除BASE_PATH前置
      let store_path = path.replace(new RegExp(`^${C.BASE_PATH}/`), "");
      res_object[store_path] = get_file_content(path);
    });
    // 写入文件
    const dirname = path.dirname(C.OUTPUT_RES_JS);
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }
    fs.writeFileSync(C.OUTPUT_RES_JS, `window.res=${JSON.stringify(res_object)}`);
  }

  /** 将js文件转化为html文件内容(包括压缩过程) */
  function get_html_code_by_js_file(js_filepath: string): string {
    let js = get_file_content(js_filepath);
    let min_js = uglify.minify(js).code;
    return `<script type="text/javascript">${min_js}</script>`;
  }

  /** 将css文件转化为html文件内容(包括压缩过程) */
  function get_html_code_by_css_file(css_filepath: string): string {
    let css = get_file_content(css_filepath);
    let min_css = new CleanCSS().minify(css).styles;
    return `<style>${min_css}</style>`;
  }

  /** 执行任务 */
  export function do_task() {
    // 前置:将res资源写成res.js
    console.time("写入res.js");
    write_resjs();
    console.timeEnd("写入res.js");

    // 清理html
    console.time("清理html");
    let html = get_file_content(C.INPUT_HTML_FILE);
    html = html.replace(/<link rel="stylesheet".*\/>/gs, "");
    html = html.replace(/<script.*<\/script>/gs, "");
    console.timeEnd("清理html");

    // 写入css
    console.log("写入所有css文件");
    C.INPUT_CSS_FILES.forEach((v) => {
      console.time(`---${path.basename(v)}`);
      html = html.replace(/<\/head>/, `${get_html_code_by_css_file(v)}\n</head>`);
      console.timeEnd(`---${path.basename(v)}`);
    });

    // 写入js
    let mainPath = C.INPUT_JS_FILES.find((v) => {
      return v.indexOf("web-mobile/main.js") != -1;
    }) as string;
    let mainJS = get_file_content(mainPath);
    let lines = mainJS.split(/\r\n|\n/);
    let n = 10;
    let isDisable = false;
    for (let i = 0; i < lines.length; ++i) {
      let line = lines[i];
      //   console.log(`第${i + 1}行: ${line}`);
      if (line.indexOf("var bundledScript") != -1) {
        isDisable = true;
      }
      if (isDisable && n > 0) {
        lines[i] = "// " + line;
        --n;
        console.log(`第${i + 1}行更新: ${lines[i]}`);
        if (n == 0) break;
      }
    }
    fs.writeFileSync(mainPath, lines.join("\n"));

    // console.log("mainJS 内容:", mainJS);

    console.log("写入所有js到html");
    C.INPUT_JS_FILES.forEach((v) => {
      console.time(`---${path.basename(v)}`);
      html = html.replace("</body>", () => `${get_html_code_by_js_file(v)}\n</body>`);
      console.timeEnd(`---${path.basename(v)}`);
    });
    
    let splashPic = "url(splash.png)";
    html = html.replace(splashPic, `/* ${splashPic} */`)

    // 写入文件并提示成功
    console.time("输出html文件");
    fs.writeFileSync(C.OUTPUT_INDEX_HTML, html);
    console.timeEnd("输出html文件");
  }
}

X.do_task();
