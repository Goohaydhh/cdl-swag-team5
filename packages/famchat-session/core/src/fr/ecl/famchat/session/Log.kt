package fr.ecl.famchat.session

/** Journal minimal, branché sur android.util.Log côté Android (voir android/AndroidLog.kt). */
interface Log {
    fun d(tag: String, msg: String)
    fun w(tag: String, msg: String, t: Throwable? = null) = d(tag, "WARN $msg${t?.let { " : ${it.message}" } ?: ""}")
}

object NoLog : Log { override fun d(tag: String, msg: String) {} }

class StdoutLog(private val prefix: String = "") : Log {
    private val t0 = System.currentTimeMillis()
    override fun d(tag: String, msg: String) {
        val ms = System.currentTimeMillis() - t0
        println("%6d ms %s[%s] %s".format(ms, prefix, tag, msg))
    }
}
