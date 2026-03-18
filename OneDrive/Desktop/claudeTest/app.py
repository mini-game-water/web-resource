from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/tetris")
def tetris():
    return render_template("tetris.html")


@app.route("/omok")
def omok():
    return render_template("omok.html")


@app.route("/chess")
def chess():
    return render_template("chess.html")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
