# Java > 从代码到运行 > 资料说明

来源：https://fqx.lx.ci/java-map/

来源：https://fqx.lx.ci/java-map/

以理解和复习效率为优先；主图只放基础主线，冷门参数、源码细节和高阶八股不放进来。

这不是 Java 知识大全，而是一条能顺着讲通的基础主线：**代码怎样运行 → 数据怎样表达 → 对象怎样协作 → 一组数据怎样保存 → 失败和 IO 怎样处理 → 并发怎样控制 → JVM 怎样管理 → 后端项目怎样组成**。

每个节点只保留最关键的解释。第一次从上到下看关系，之后按薄弱节点复习，不需要一次展开全部。

# Java > 从代码到运行

来源：https://fqx.lx.ci/java-map/

先写一个类和 main 方法，再由 JDK 编译成字节码，最后交给 JVM 运行。后面的类型、对象、集合、线程，本质上都是在描述 JVM 里运行的数据和行为。

# Java > 从代码到运行 > JDK、JRE、JVM 是什么关系

来源：https://fqx.lx.ci/java-map/

**JDK 是开发工具箱**，里面有编译器和运行环境；**JVM 是真正执行 Java 字节码的虚拟机**。

可以记成：写代码用 JDK，运行代码靠 JVM。Java 能跨平台，是因为同一份字节码可以交给不同系统上的 JVM。

# Java > 从代码到运行 > 程序从 main 方法开始

来源：https://fqx.lx.ci/java-map/

Java 代码放在类里，普通程序从 `main` 方法进入：

```java
public class App {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

先用 `javac` 编译为 `.class` 字节码，再由 `java` 命令启动 JVM 执行。

# Java > 从代码到运行 > 变量和类型：数据是什么

来源：https://fqx.lx.ci/java-map/

变量就是给数据起名字。Java 是**静态类型语言**，变量在编译时就要确定类型。

- 基本类型保存简单值：整数、浮点数、字符、布尔值
- 引用类型保存对象的引用：String、数组、自己定义的类

基本类型有默认范围，金额不要用 `double`，通常用 `BigDecimal`。

# Java > 从代码到运行 > 判断和循环：决定代码怎么走

来源：https://fqx.lx.ci/java-map/

`if / switch` 负责选择分支，`for / while` 负责重复执行。

控制流只解决两件事：**满足什么条件做什么，以及一件事做多少次**。逻辑变复杂时不要继续堆分支，应把一段职责明确的代码抽成方法。

# Java > 从代码到运行 > 方法：把一段行为起名字

来源：https://fqx.lx.ci/java-map/

方法接收参数、完成一件事、返回结果。它让重复逻辑可以复用，也让大问题能拆成小步骤。

Java 传参永远是**值传递**：基本类型复制值，对象参数复制的是引用值，所以方法可以修改对象内容，但不能替换调用方手里的引用。
